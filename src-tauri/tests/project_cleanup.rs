//! 项目删除时的共享上下文关联清理回归测试。
//!
//! 覆盖：
//!  - 删除项目会清理该项目的 `context_reference_entries` 与停用标记；
//!  - 其它项目的引用记录与设置不受影响；
//!  - 清理与项目删除处于同一事务，删除失败时不会留下部分成功状态。
//!
//! 所有用例均使用内存数据库与临时目录，不接触真实用户数据。

use std::path::Path;

use tempfile::TempDir;
use vibeacross_lib::db::Database;
use vibeacross_lib::models::Project;
use vibeacross_lib::projects;
use vibeacross_lib::settings;

fn temp_dir() -> TempDir {
    tempfile::tempdir().expect("创建临时目录失败")
}

fn project_in(conn: &rusqlite::Connection, workspace: &Path, name: &str) -> Project {
    std::fs::create_dir_all(workspace).unwrap();
    projects::create_project(conn, name, &workspace.to_string_lossy()).unwrap()
}

fn add_reference_entry(conn: &rusqlite::Connection, project_id: &str) {
    conn.execute(
        "INSERT INTO context_reference_entries (project_id, kind, target_file, entry, created_at)
         VALUES (?1, 'opencode', 'opencode.json', '.vibeacross/context.md', '2026-01-01T00:00:00Z')",
        [project_id],
    )
    .unwrap();
}

fn reference_entry_count(conn: &rusqlite::Connection, project_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM context_reference_entries WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn disabled_key(project_id: &str) -> String {
    format!("shared_context_disabled.{project_id}")
}

fn set_disabled_flag(conn: &rusqlite::Connection, project_id: &str) {
    settings::write_setting(conn, &disabled_key(project_id), Some("1")).unwrap();
}

fn has_disabled_flag(conn: &rusqlite::Connection, project_id: &str) -> bool {
    settings::read_setting(conn, &disabled_key(project_id))
        .unwrap()
        .as_deref()
        == Some("1")
}

#[test]
fn remove_project_clears_entries_and_flag_for_target_only() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let target = project_in(&conn, &workspace.path().join("target"), "Target");
    let other = project_in(&conn, &workspace.path().join("other"), "Other");

    add_reference_entry(&conn, &target.id);
    add_reference_entry(&conn, &other.id);
    set_disabled_flag(&conn, &target.id);
    set_disabled_flag(&conn, &other.id);

    projects::remove_project(&conn, &target.id).unwrap();

    // 目标项目的关联与设置均已清理。
    assert!(projects::get_project(&conn, &target.id).is_err());
    assert_eq!(reference_entry_count(&conn, &target.id), 0);
    assert!(!has_disabled_flag(&conn, &target.id));

    // 其它项目不受影响。
    assert!(projects::get_project(&conn, &other.id).is_ok());
    assert_eq!(reference_entry_count(&conn, &other.id), 1);
    assert!(has_disabled_flag(&conn, &other.id));
}

#[test]
fn failed_project_removal_rolls_back_new_cleanup() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project = project_in(&conn, &workspace.path().join("rollback"), "Rollback");
    add_reference_entry(&conn, &project.id);
    set_disabled_flag(&conn, &project.id);

    // 让清理停用标记的 DELETE 失败，从而验证整个删除事务回滚。
    conn.execute_batch(
        "CREATE TRIGGER block_disabled_cleanup BEFORE DELETE ON app_settings
         WHEN OLD.key LIKE 'shared_context_disabled.%'
         BEGIN SELECT RAISE(ABORT, 'blocked for test'); END;",
    )
    .unwrap();

    let error = projects::remove_project(&conn, &project.id).unwrap_err();
    assert!(!error.code.is_empty());

    // 删除失败：项目、引用登记与停用标记都保持不变（新清理未单独提交）。
    assert!(projects::get_project(&conn, &project.id).is_ok());
    assert_eq!(reference_entry_count(&conn, &project.id), 1);
    assert!(has_disabled_flag(&conn, &project.id));
}
