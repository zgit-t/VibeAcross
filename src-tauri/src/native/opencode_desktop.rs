//! OpenCode 桌面应用（OpenCode Desktop）的原生会话**只读**适配器。
//!
//! 能力依据（已核实）：OpenCode 桌面应用是图形界面外壳，内部运行与 `opencode`
//! 命令行工具**相同的 OpenCode 服务内核**，并共用**同一份本地会话存储**
//! （`%USERPROFILE%\.local\share\opencode\opencode.db`，SQLite；会话表 `session`）。
//! 因此其历史会话与命令行工具**同源**，本适配器以**只读**方式直接查询该数据库：
//!
//! ```text
//! %USERPROFILE%\.local\share\opencode\opencode.db → 表 session(id, title, directory, time_created, time_updated, time_archived, ...)
//! ```
//!
//! - 会话标识：`session.id`（稳定）；
//! - 归属项目：`session.directory` 字段比对当前项目目录；
//! - 标题：`session.title`（清理后）；
//! - 时间：`time_created` / `time_updated`（毫秒时间戳）；排除已归档（`time_archived` 非空）。
//!
//! 说明：桌面应用内嵌的本地服务仅监听**随机**回环端口，并使用每次启动**随机生成**的
//! 密码（HTTP Basic 认证，来源限于应用自身），外部进程无法发现 / 连接；其可执行文件
//! 为图形程序，不能作为无头服务启动。因此本适配器**不提供**创建 / 恢复 / 改名 / 删除
//! 能力，也绝不写入 / 迁移 / 删除任何原始数据。

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

use crate::error::AppError;

use super::common;
use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 生成标题时的最大字符数。
const TITLE_MAX_CHARS: usize = 80;
/// 数据库存在但缺少预期的会话表（结构不受支持）。
const STRUCTURE_CODE: &str = "NATIVE_STORE_STRUCTURE";

/// 定位 OpenCode（命令行与桌面应用共用）的本地会话数据库。
fn database_path() -> Option<PathBuf> {
    common::user_home().map(|home| {
        home.join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db")
    })
}

/// 枚举当前项目目录下的 OpenCode Desktop 历史会话（按更新时间倒序）。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let db = database_path().ok_or_else(|| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            "无法确定用户主目录，无法定位 OpenCode 的本地会话数据库。",
        )
    })?;
    list_in(&db, &ctx.working_dir)
}

/// 带来源状态的枚举：数据库不存在 → 来源缺失；结构不符 → 结构不受支持；其余失败 → 无法读取。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let Some(db) = database_path() else {
        return Ok(HistoryListing::unreadable());
    };
    if !db.is_file() {
        return Ok(HistoryListing::source_missing());
    }
    match list_in(&db, &ctx.working_dir) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(error) if error.code == STRUCTURE_CODE => Ok(HistoryListing::structure_unsupported()),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 从给定数据库只读枚举归属 `working_dir` 的会话（便于受控测试）。
pub(crate) fn list_in(
    db_path: &Path,
    working_dir: &Path,
) -> Result<Vec<NativeSessionInfo>, AppError> {
    if !db_path.is_file() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(
        |error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!(
                    "无法只读打开 OpenCode 会话数据库（{}）：{error}",
                    db_path.display()
                ),
            )
        },
    )?;

    // 先确认预期的会话表存在，避免把「结构不符」误报为「读取失败」。
    let has_session_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session' LIMIT 1",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !has_session_table {
        return Err(AppError::new(
            STRUCTURE_CODE,
            "OpenCode 会话数据库缺少预期的 `session` 表。",
        ));
    }

    let target = common::normalize_path(&working_dir.to_string_lossy());
    let mut statement = conn
        .prepare(
            "SELECT id, title, directory, time_created, time_updated \
             FROM session WHERE time_archived IS NULL",
        )
        .map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("读取 OpenCode 会话表失败：{error}"),
            )
        })?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("查询 OpenCode 会话失败：{error}"),
            )
        })?;

    let mut items = Vec::new();
    for row in rows {
        let (id, title, directory, created_at, updated_at) = row.map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("读取 OpenCode 会话记录失败：{error}"),
            )
        })?;
        if id.trim().is_empty() {
            continue;
        }
        let directory = directory.unwrap_or_default();
        if common::normalize_path(&directory) != target {
            continue;
        }
        items.push(NativeSessionInfo {
            native_id: id,
            title: title
                .as_deref()
                .and_then(|value| common::sanitize_title(value, TITLE_MAX_CHARS)),
            directory: Some(directory),
            created_at: created_at.and_then(common::epoch_millis_to_iso),
            updated_at: updated_at.and_then(common::epoch_millis_to_iso),
        });
    }

    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 建一个与真实 opencode 会话表同构（仅含本适配器用到的列）的测试数据库。
    fn create_db(path: &Path) -> Connection {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (\
                id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL, \
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, \
                time_archived INTEGER);",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, dir: &str, title: &str, updated: i64, archived: Option<i64>) {
        conn.execute(
            "INSERT INTO session (id, title, directory, time_created, time_updated, time_archived) \
             VALUES (?1, ?2, ?3, 1000, ?4, ?5)",
            rusqlite::params![id, title, dir, updated, archived],
        )
        .unwrap();
    }

    #[test]
    fn returns_only_sessions_of_current_project_sorted_by_update() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("opencode.db");
        let conn = create_db(&db);
        insert(&conn, "ses_a", "D:/works/VibeAcross", "会话 A", 2000, None);
        insert(&conn, "ses_b", "D:/works/VibeAcross", "会话 B", 5000, None);
        insert(&conn, "ses_other", "D:/works/other", "别的项目", 9000, None);
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 2, "只应返回当前项目目录下的会话");
        assert_eq!(items[0].native_id, "ses_b", "应按更新时间倒序");
        assert_eq!(items[1].native_id, "ses_a");
        assert_eq!(items[0].title.as_deref(), Some("会话 B"));
        assert!(items[0].updated_at.is_some());
    }

    #[test]
    fn directory_match_ignores_case_separators_and_trailing_slash() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("opencode.db");
        let conn = create_db(&db);
        insert(&conn, "ses_1", "d:/Works/vibeacross/", "标题", 1000, None);
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "ses_1");
    }

    #[test]
    fn excludes_archived_sessions() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("opencode.db");
        let conn = create_db(&db);
        insert(&conn, "ses_active", "D:/works/VibeAcross", "保留", 2000, None);
        insert(&conn, "ses_archived", "D:/works/VibeAcross", "已归档", 3000, Some(9999));
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "ses_active");
    }

    #[test]
    fn missing_database_is_empty_list() {
        let root = tempfile::tempdir().unwrap();
        let items = list_in(&root.path().join("nope.db"), Path::new(r"D:\works\VibeAcross")).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn database_without_session_table_is_reported_as_structure_unsupported() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("opencode.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE unrelated (id TEXT PRIMARY KEY);")
            .unwrap();
        drop(conn);

        let error = list_in(&db, Path::new(r"D:\works\VibeAcross")).unwrap_err();
        assert_eq!(error.code, STRUCTURE_CODE);
    }
}
