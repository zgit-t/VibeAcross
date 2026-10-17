//! WorkBuddy 桌面应用的原生会话**只读**适配器。
//!
//! 能力依据：WorkBuddy 为 Electron 桌面应用，未提供可调用的会话创建 / 恢复 / 改名 /
//! 删除接口，因此**不提供**上述能力。历史会话来自其本地数据库：
//!
//! ```text
//! %USERPROFILE%\.workbuddy\workbuddy.db   → 表 sessions(id, cwd, title, custom_title, ...)
//! ```
//!
//! - 会话标识：`sessions.id`（conversationId，稳定）；
//! - 归属项目：`sessions.cwd` 字段（权威）比对当前项目目录；
//! - 标题：`custom_title` 优先，否则 `title`（清理后）；
//! - 时间：`created_at` / `updated_at`（毫秒时间戳）。
//!
//! 说明：`~/.workbuddy/sessions/<pid>.json` 只是运行中的守护进程状态，**不是**会话历史，
//! 因此不读取。数据库一律以**只读**方式打开，绝不修改 / 迁移 / 删除任何原始数据。

use rusqlite::{Connection, OpenFlags};
use std::path::Path;

use crate::error::AppError;

use super::common;
use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 生成标题时的最大字符数。
const TITLE_MAX_CHARS: usize = 80;

/// 枚举当前项目目录下的 WorkBuddy 历史会话（按更新时间倒序）。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let home = common::user_home().ok_or_else(|| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            "无法确定用户主目录，无法定位 WorkBuddy 的本地会话数据库。",
        )
    })?;
    let db = home.join(".workbuddy").join("workbuddy.db");
    list_in(&db, &ctx.working_dir)
}

/// 带来源状态的枚举：数据库不存在 → 来源缺失；打开 / 查询失败 → 无法读取。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let Some(home) = common::user_home() else {
        return Ok(HistoryListing::unreadable());
    };
    let db = home.join(".workbuddy").join("workbuddy.db");
    if !db.is_file() {
        return Ok(HistoryListing::source_missing());
    }
    match list_in(&db, &ctx.working_dir) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 从给定数据库只读枚举归属 `working_dir` 的会话（便于受控测试）。
pub(crate) fn list_in(db_path: &Path, working_dir: &Path) -> Result<Vec<NativeSessionInfo>, AppError> {
    if !db_path.is_file() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("无法只读打开 WorkBuddy 会话数据库（{}）：{error}", db_path.display()),
        )
    })?;

    let target = common::normalize_path(&working_dir.to_string_lossy());
    let mut statement = conn
        .prepare(
            "SELECT id, cwd, COALESCE(NULLIF(TRIM(custom_title), ''), title), created_at, updated_at \
             FROM sessions WHERE deleted_at IS NULL AND is_playground = 0",
        )
        .map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("读取 WorkBuddy 会话表失败：{error}"),
            )
        })?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("查询 WorkBuddy 会话失败：{error}"),
            )
        })?;

    let mut items = Vec::new();
    for row in rows {
        let (id, cwd, title, created_at, updated_at) = row.map_err(|error| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("读取 WorkBuddy 会话记录失败：{error}"),
            )
        })?;
        if id.trim().is_empty() {
            continue;
        }
        if common::normalize_path(&cwd) != target {
            continue;
        }
        items.push(NativeSessionInfo {
            native_id: id,
            title: title.as_deref().and_then(|value| common::sanitize_title(value, TITLE_MAX_CHARS)),
            directory: Some(cwd),
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

    fn create_db(path: &Path) -> Connection {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (\
                id TEXT PRIMARY KEY, cwd TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '', \
                title TEXT, custom_title TEXT, status TEXT NOT NULL DEFAULT 'completed', \
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, \
                is_playground INTEGER NOT NULL DEFAULT 0);",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, cwd: &str, title: Option<&str>, custom: Option<&str>, deleted: Option<i64>) {
        conn.execute(
            "INSERT INTO sessions (id, cwd, title, custom_title, created_at, updated_at, deleted_at, is_playground) \
             VALUES (?1, ?2, ?3, ?4, 1000, 2000, ?5, 0)",
            rusqlite::params![id, cwd, title, custom, deleted],
        )
        .unwrap();
    }

    #[test]
    fn returns_only_sessions_of_current_project() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join(".workbuddy").join("workbuddy.db");
        let conn = create_db(&db);
        insert(&conn, "wb-water", r"D:\works\waterbill", Some("水电费记账"), None, None);
        insert(&conn, "wb-other", r"D:\works\other", Some("别的项目"), None, None);
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\works\waterbill")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "wb-water");
        assert_eq!(items[0].title.as_deref(), Some("水电费记账"));
        assert_eq!(items[0].directory.as_deref(), Some(r"D:\works\waterbill"));
        assert!(items[0].updated_at.is_some());
    }

    #[test]
    fn custom_title_takes_priority_and_matches_case_insensitively() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("workbuddy.db");
        let conn = create_db(&db);
        insert(&conn, "wb-1", r"d:/works/waterbill/", Some("原始标题"), Some("自定义标题"), None);
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\Works\Waterbill")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title.as_deref(), Some("自定义标题"));
    }

    #[test]
    fn excludes_deleted_and_playground_sessions() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("workbuddy.db");
        let conn = create_db(&db);
        insert(&conn, "wb-active", r"D:\works\waterbill", Some("保留"), None, None);
        insert(&conn, "wb-deleted", r"D:\works\waterbill", Some("已删除"), None, Some(9999));
        conn.execute(
            "INSERT INTO sessions (id, cwd, title, created_at, updated_at, is_playground) \
             VALUES ('wb-play', 'D:\\works\\waterbill', '演示', 1, 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let items = list_in(&db, Path::new(r"D:\works\waterbill")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "wb-active");
    }

    #[test]
    fn missing_database_is_empty_list() {
        let root = tempfile::tempdir().unwrap();
        let items = list_in(&root.path().join("nope.db"), Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty());
    }
}
