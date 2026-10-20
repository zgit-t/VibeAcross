use crate::error::AppError;
use rusqlite::Connection;

/// 迁移列表：(名称, SQL)。
///
/// 版本号由 SQLite 的 `PRAGMA user_version` 管理（从 0 开始）。
/// 新增迁移时在末尾追加即可，已有迁移不得修改，以保证可重复、安全执行。
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../migrations/0001_init.sql")),
    ("0002_tools", include_str!("../migrations/0002_tools.sql")),
    (
        "0003_project_tools",
        include_str!("../migrations/0003_project_tools.sql"),
    ),
    (
        "0004_tasks_activity",
        include_str!("../migrations/0004_tasks_activity.sql"),
    ),
    (
        "0005_workspace_sessions",
        include_str!("../migrations/0005_workspace_sessions.sql"),
    ),
    (
        "0006_drop_activity",
        include_str!("../migrations/0006_drop_activity.sql"),
    ),
    (
        "0007_session_model",
        include_str!("../migrations/0007_session_model.sql"),
    ),
    (
        "0008_project_current_tool",
        include_str!("../migrations/0008_project_current_tool.sql"),
    ),
    (
        "0009_memory_files",
        include_str!("../migrations/0009_memory_files.sql"),
    ),
    (
        "0010_memory_records",
        include_str!("../migrations/0010_memory_records.sql"),
    ),
    (
        "0011_memory_promotion",
        include_str!("../migrations/0011_memory_promotion.sql"),
    ),
    (
        "0012_native_session_claims",
        include_str!("../migrations/0012_native_session_claims.sql"),
    ),
    (
        "0013_context_reference_entries",
        include_str!("../migrations/0013_context_reference_entries.sql"),
    ),
];

/// 当前应用支持的最新数据库版本（等于已登记迁移的数量）。
pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// 将数据库升级到最新版本。已应用过的迁移会被跳过，不会破坏已有数据。
pub fn run(conn: &Connection) -> Result<(), AppError> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let mut version = current_version.max(0) as usize;

    if version > MIGRATIONS.len() {
        return Err(AppError::new(
            "DB_VERSION_UNSUPPORTED",
            "数据库版本高于当前应用支持的版本，请升级应用。",
        ));
    }

    while version < MIGRATIONS.len() {
        let (name, sql) = MIGRATIONS[version];
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql).map_err(|error| {
            AppError::new("MIGRATION_FAILED", format!("迁移 {name} 执行失败：{error}"))
        })?;
        tx.pragma_update(None, "user_version", (version as i64) + 1)?;
        tx.commit()?;
        version += 1;
    }

    Ok(())
}
