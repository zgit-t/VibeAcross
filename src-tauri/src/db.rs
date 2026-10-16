use crate::{backup, error::AppError, migrations};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// SQLite 连接的受控封装。
///
/// 使用 `Mutex<Connection>` 串行化访问，避免并发写入造成不一致。
/// 本地桌面场景下查询量很小，串行访问是安全且足够的选择。
pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

/// 判断两个路径是否指向同一个文件（用于阻止把数据库备份到自身 / 从自身恢复）。
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
}

impl Database {
    /// 打开（必要时创建）位于指定路径的数据库，并执行迁移。
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let conn = Self::open_connection(&path)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    /// 打开一个已存在 / 待创建的数据库连接：建目录、打开、准备 PRAGMA 并执行迁移。
    fn open_connection(path: &Path) -> Result<Connection, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "DB_DIR_CREATE_FAILED",
                    format!("无法创建数据目录 {}：{error}", parent.display()),
                )
            })?;
        }

        let conn = Connection::open(path).map_err(|error| {
            AppError::new("DB_OPEN_FAILED", format!("无法打开数据库：{error}"))
        })?;

        Self::prepare(&conn)?;
        migrations::run(&conn)?;
        Ok(conn)
    }

    /// 内存数据库，仅用于测试。
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()
            .map_err(|error| AppError::new("DB_OPEN_FAILED", format!("无法创建内存数据库：{error}")))?;
        Self::prepare(&conn)?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        })
    }

    fn prepare(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;

        // journal_mode 会返回一行结果，单独消费。
        let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;

        // 快速完整性校验，尽早发现损坏的数据库文件。
        let integrity: String =
            conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(AppError::new(
                "DB_CORRUPTED",
                "数据库文件校验失败，可能已损坏。",
            ));
        }

        Ok(())
    }

    /// 获取数据库连接；持有期间会串行化所有访问。
    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.conn.lock().map_err(|_| {
            AppError::new("DB_LOCK_FAILED", "数据库连接状态异常，请重启应用后重试。")
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 创建一个一致性备份到 `target`（不覆盖已存在文件，除非 `overwrite`）。
    pub fn create_backup(
        &self,
        target: &Path,
        overwrite: bool,
    ) -> Result<backup::BackupInfo, AppError> {
        if !self.path.starts_with(":memory:") && same_file(&self.path, target) {
            return Err(AppError::new(
                "BACKUP_TARGET_IS_LIVE",
                "不能把数据库备份到正在使用的数据库文件本身。",
            ));
        }
        let conn = self.conn()?;
        backup::create_backup(&conn, target, overwrite)
    }

    /// 从备份文件受控恢复：校验 → 保护性备份 → 关闭连接 → 替换文件 → 重开校验。
    ///
    /// 任一环节失败都会尽量从保护性备份回滚到操作前状态，绝不静默删除现有数据。
    pub fn restore_from(&self, source: &Path) -> Result<backup::RestoreInfo, AppError> {
        // 1. 恢复前先只读校验备份文件，绝不用未校验的文件覆盖当前数据库。
        let inspected = backup::inspect_backup_file(source)?;

        if !self.path.starts_with(":memory:") && same_file(&self.path, source) {
            return Err(AppError::new(
                "RESTORE_SOURCE_IS_LIVE",
                "所选文件就是当前正在使用的数据库，无需恢复。",
            ));
        }

        let mut guard = self.conn.lock().map_err(|_| {
            AppError::new("DB_LOCK_FAILED", "数据库连接状态异常，请重启应用后重试。")
        })?;

        // 2. 为当前数据创建保护性备份；失败则中止恢复，不改动任何数据。
        let protective = self.protective_backup_path();
        backup::create_backup(&guard, &protective, false).map_err(|error| {
            AppError::new(
                "RESTORE_PROTECTIVE_BACKUP_FAILED",
                format!("创建保护性备份失败，已取消恢复：{}", error.message),
            )
        })?;
        let protective_path = protective.to_string_lossy().into_owned();

        // 3. 关闭当前连接（用内存占位连接替换，保证 Mutex 始终持有可用连接）。
        let placeholder = Connection::open_in_memory().map_err(|error| {
            AppError::new("RESTORE_FAILED", format!("无法准备恢复流程：{error}"))
        })?;
        let old = std::mem::replace(&mut *guard, placeholder);
        let _ = old.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        drop(old);

        // 4. 用备份文件原子替换数据库主文件。
        if let Err(error) = backup::swap_file(&self.path, source) {
            return Err(match self.rollback(&mut guard, &protective) {
                Ok(()) => error,
                Err(rollback_error) => rollback_error,
            });
        }

        // 5. 重新打开连接（含 PRAGMA 与迁移）并校验恢复结果。
        match Self::open_connection(&self.path).and_then(|conn| {
            self.verify_restored(&conn, &inspected)?;
            Ok(conn)
        }) {
            Ok(conn) => {
                *guard = conn;
                Ok(backup::RestoreInfo {
                    source_path: source.to_string_lossy().into_owned(),
                    protective_backup_path: protective_path,
                    schema_version: inspected.schema_version,
                    counts: inspected.counts,
                })
            }
            Err(error) => {
                let rollback = self.rollback(&mut guard, &protective);
                match rollback {
                    Ok(()) => Err(AppError::new(
                        "RESTORE_FAILED",
                        format!("恢复未通过校验，已回滚到操作前状态：{}", error.message),
                    )),
                    Err(rollback_error) => Err(rollback_error),
                }
            }
        }
    }

    /// 恢复前保护性备份的路径（与数据库同目录，带时间戳，避免覆盖）。
    fn protective_backup_path(&self) -> PathBuf {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
        parent.join(format!("vibeacross.pre-restore-{stamp}.db"))
    }

    /// 从保护性备份回滚数据库文件并重新打开连接。
    fn rollback(
        &self,
        guard: &mut MutexGuard<'_, Connection>,
        protective: &Path,
    ) -> Result<(), AppError> {
        backup::swap_file(&self.path, protective).map_err(|error| {
            AppError::new(
                "RESTORE_ROLLBACK_FAILED",
                format!(
                    "恢复失败且自动回滚未成功，请手动使用保护性备份 {}：{}",
                    protective.display(),
                    error.message
                ),
            )
        })?;
        let conn = Self::open_connection(&self.path).map_err(|error| {
            AppError::new(
                "RESTORE_ROLLBACK_FAILED",
                format!(
                    "回滚后重新打开数据库失败，请手动使用保护性备份 {}：{}",
                    protective.display(),
                    error.message
                ),
            )
        })?;
        **guard = conn;
        Ok(())
    }

    /// 恢复后核验：完整性与各表行数应与备份一致。
    fn verify_restored(
        &self,
        conn: &Connection,
        expected: &backup::BackupInfo,
    ) -> Result<(), AppError> {
        let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(AppError::new(
                "RESTORE_VERIFY_FAILED",
                "恢复后的数据库完整性校验未通过。",
            ));
        }

        let counts = backup::read_counts(conn)?;
        let expected = &expected.counts;
        if counts.projects != expected.projects
            || counts.tasks != expected.tasks
            || counts.tool_installations != expected.tool_installations
            || counts.workspace_sessions != expected.workspace_sessions
            || counts.settings != expected.settings
        {
            return Err(AppError::new(
                "RESTORE_VERIFY_FAILED",
                "恢复后的数据行数与备份不一致。",
            ));
        }
        Ok(())
    }
}
