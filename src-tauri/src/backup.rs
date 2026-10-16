//! 本地数据库备份与恢复的纯逻辑部分。
//!
//! 设计要点：
//!  - **一致性快照**：备份使用 SQLite 的 `VACUUM INTO`，一次性生成完整的、
//!    已整理的单文件数据库，正确包含 WAL 中已提交的数据，**不直接复制**正在
//!    使用的数据库主文件，也不产生 `-wal` / `-shm` 边车文件。
//!  - **不覆盖**：目标文件已存在且未显式允许覆盖时直接拒绝；覆盖时先写入
//!    同目录的临时文件，成功后再原子替换，避免留下半成品。
//!  - **校验**：恢复前对备份文件做只读打开、`quick_check`、必需表与版本校验，
//!    绝不把未经校验的文件用于覆盖当前数据库。
//!  - **无敏感信息**：数据库不存储访问令牌 / 密码等，因此备份不含此类内容。
//!
//! 连接生命周期与「受控替换 + 回滚」在 [`crate::db::Database`] 中实现，
//! 本模块只处理与具体连接生命周期无关的文件 / SQLite 操作。

use crate::error::AppError;
use crate::migrations;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// 备份文件扩展名（用于文件对话框中识别本应用的备份文件）。
pub const BACKUP_EXTENSION: &str = "vibeacross-backup";

/// 备份文件必须包含的核心表；缺失即视为不是有效的 VibeAcross 备份。
const REQUIRED_TABLES: &[&str] = &["projects", "app_settings"];

/// 备份中记录的数据规模，用于向用户展示恢复覆盖范围。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub projects: i64,
    pub tasks: i64,
    pub tool_installations: i64,
    pub workspace_sessions: i64,
    pub settings: i64,
}

/// 对备份文件（或刚创建的备份）的描述。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// 备份创建时间（取自文件修改时间，UTC ISO 8601）。
    pub created_at: String,
    pub schema_version: i64,
    pub counts: BackupCounts,
}

/// 恢复操作的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreInfo {
    /// 实际用于恢复的备份文件路径。
    pub source_path: String,
    /// 恢复前为当前数据创建的保护性备份路径（可用于手动回退）。
    pub protective_backup_path: String,
    pub schema_version: i64,
    pub counts: BackupCounts,
}

/// 生成建议的备份文件名（可识别的名称 + 专用扩展名）。
pub fn suggested_file_name() -> String {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    format!("VibeAcross-{stamp}.{BACKUP_EXTENSION}")
}

/// 生成一个「时间戳 + 毫秒」记号，用于保护性备份与临时文件命名。
fn now_token() -> String {
    chrono::Local::now()
        .format("%Y%m%d-%H%M%S%3f")
        .to_string()
}

/// 将字符串转义为 SQLite 单引号字符串字面量（转义内部单引号）。
fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// 统计单个表的行数；表不存在时返回 `None`。
fn table_count(conn: &Connection, table: &str) -> Result<Option<i64>, AppError> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Ok(None);
    }
    // table 仅来自本模块内的固定常量，不存在注入风险。
    let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })?;
    Ok(Some(count))
}

/// 读取数据库中与备份相关的表行数（缺失表计为 0）。
pub fn read_counts(conn: &Connection) -> Result<BackupCounts, AppError> {
    let get = |table: &str| -> Result<i64, AppError> { Ok(table_count(conn, table)?.unwrap_or(0)) };
    Ok(BackupCounts {
        projects: get("projects")?,
        tasks: get("tasks")?,
        tool_installations: get("tool_installations")?,
        workspace_sessions: get("workspace_sessions")?,
        settings: get("app_settings")?,
    })
}

/// 返回数据库主文件的边车文件路径（`-wal` / `-shm`）。
pub fn sidecar_paths(db_path: &Path) -> [PathBuf; 2] {
    let mut wal = db_path.as_os_str().to_os_string();
    wal.push("-wal");
    let mut shm = db_path.as_os_str().to_os_string();
    shm.push("-shm");
    [PathBuf::from(wal), PathBuf::from(shm)]
}

/// 删除数据库的 `-wal` / `-shm` 边车文件（不存在则忽略）。
pub fn remove_sidecars(db_path: &Path) -> Result<(), AppError> {
    for path in sidecar_paths(db_path) {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::new(
                    "RESTORE_SIDECAR_FAILED",
                    format!("无法清理数据库辅助文件 {}：{error}", path.display()),
                ));
            }
        }
    }
    Ok(())
}

/// 在两个路径之间做「复制到临时文件 + 原子替换」，用于替换数据库主文件。
pub fn swap_file(db_path: &Path, source: &Path) -> Result<(), AppError> {
    let parent = db_path.parent().unwrap_or_else(|| Path::new("."));
    let staging = parent.join(format!(
        "{}.restore-{}.tmp",
        db_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "vibeacross.db".to_string()),
        now_token()
    ));

    let _ = fs::remove_file(&staging);
    fs::copy(source, &staging).map_err(|error| {
        AppError::new(
            "RESTORE_COPY_FAILED",
            format!("无法写入恢复临时文件 {}：{error}", staging.display()),
        )
    })?;

    remove_sidecars(db_path)?;

    // Windows 下 `rename` 使用 MoveFileEx(REPLACE_EXISTING)，可原子替换已存在文件。
    if let Err(error) = fs::rename(&staging, db_path) {
        let _ = fs::remove_file(&staging);
        return Err(AppError::new(
            "RESTORE_REPLACE_FAILED",
            format!("无法替换数据库文件：{error}"),
        ));
    }
    Ok(())
}

/// 创建一个一致性备份到 `target`。
///
/// - `overwrite == false` 且目标已存在时返回 `BACKUP_TARGET_EXISTS`。
/// - 先在同目录写入临时文件，成功后原子替换目标，避免留下损坏的半成品。
pub fn create_backup(
    conn: &Connection,
    target: &Path,
    overwrite: bool,
) -> Result<BackupInfo, AppError> {
    if target.as_os_str().is_empty() {
        return Err(AppError::new("BACKUP_TARGET_INVALID", "未指定备份文件路径。"));
    }
    if target.is_dir() {
        return Err(AppError::new(
            "BACKUP_TARGET_INVALID",
            "备份路径指向一个目录，请选择文件名。",
        ));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(AppError::new(
                "BACKUP_DIR_MISSING",
                format!("备份目录不存在：{}", parent.display()),
            ));
        }
    }
    if target.exists() && !overwrite {
        return Err(AppError::new(
            "BACKUP_TARGET_EXISTS",
            "目标文件已存在，请选择其它名称或确认覆盖。",
        ));
    }

    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let staging = parent.join(format!(".vibeacross-backup-{}.tmp", now_token()));
    let _ = fs::remove_file(&staging);

    let target_str = staging.to_string_lossy().into_owned();
    if let Err(error) = conn.execute_batch(&format!(
        "VACUUM INTO {}",
        sql_string_literal(&target_str)
    )) {
        let _ = fs::remove_file(&staging);
        return Err(AppError::new(
            "BACKUP_FAILED",
            format!("创建备份失败：{error}"),
        ));
    }

    if let Err(error) = fs::rename(&staging, target) {
        let _ = fs::remove_file(&staging);
        return Err(AppError::new(
            "BACKUP_FAILED",
            format!("写入备份文件失败：{error}"),
        ));
    }

    inspect_backup_file(target)
}

/// 读取文件头（最多 16 字节），用于判断是否为 SQLite 数据库文件。
fn read_header(path: &Path) -> Result<Vec<u8>, AppError> {
    use std::io::Read;
    let mut file = fs::File::open(path)
        .map_err(|error| AppError::new("BACKUP_INVALID", format!("无法读取备份文件：{error}")))?;
    let mut buffer = [0u8; 16];
    let read = file
        .read(&mut buffer)
        .map_err(|error| AppError::new("BACKUP_INVALID", format!("无法读取备份文件：{error}")))?;
    Ok(buffer[..read].to_vec())
}

/// 只读校验一个备份文件并读取其元信息。
///
/// 依次检查：存在且为文件、非空、是有效 SQLite 数据库、`quick_check` 通过、
/// 包含必需表、数据库版本不高于当前应用支持版本。
pub fn inspect_backup_file(path: &Path) -> Result<BackupInfo, AppError> {
    if !path.exists() {
        return Err(AppError::new(
            "BACKUP_NOT_FOUND",
            "找不到所选备份文件。",
        ));
    }
    if !path.is_file() {
        return Err(AppError::new(
            "BACKUP_INVALID",
            "所选路径不是文件。",
        ));
    }

    let metadata = fs::metadata(path).map_err(|error| {
        AppError::new("BACKUP_INVALID", format!("无法读取备份文件信息：{error}"))
    })?;
    let size_bytes = metadata.len();
    if size_bytes == 0 {
        return Err(AppError::new("BACKUP_INVALID", "备份文件为空。"));
    }

    // 先按文件头判定是否为 SQLite 数据库，以便区分「不是数据库」与「已损坏」。
    let header = read_header(path)?;
    if &header != b"SQLite format 3\0" {
        return Err(AppError::new(
            "BACKUP_INVALID",
            "所选文件不是有效的 SQLite 数据库，可能不是 VibeAcross 备份。",
        ));
    }

    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| AppError::new("BACKUP_CORRUPTED", format!("无法打开备份文件：{error}")))?;

    let integrity: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| {
            AppError::new(
                "BACKUP_CORRUPTED",
                format!("备份文件已损坏，无法读取：{error}"),
            )
        })?;
    if integrity != "ok" {
        return Err(AppError::new(
            "BACKUP_CORRUPTED",
            "备份文件已损坏，完整性校验未通过。",
        ));
    }

    for table in REQUIRED_TABLES {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::new(
                "BACKUP_INVALID",
                format!("备份缺少必需的数据表（{table}），无法确认是本应用的数据。"),
            ));
        }
    }

    let schema_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if schema_version > migrations::latest_version() {
        return Err(AppError::new(
            "BACKUP_INCOMPATIBLE",
            "备份来自更高版本的应用，当前版本无法安全恢复。",
        ));
    }

    let counts = read_counts(&conn)?;

    let created_at = metadata
        .modified()
        .ok()
        .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_else(crate::now_iso);

    Ok(BackupInfo {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size_bytes,
        created_at,
        schema_version,
        counts,
    })
}
