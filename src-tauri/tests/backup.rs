use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use vibeacross_lib::backup;
use vibeacross_lib::db::Database;
use vibeacross_lib::migrations;

fn temp_dir() -> TempDir {
    tempfile::tempdir().expect("创建临时目录失败")
}

fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
        .unwrap()
}

/// 写入一组相互关联的数据（项目 / 工具 / 任务 / 工作上下文 / 设置）。
fn seed(conn: &rusqlite::Connection) {
    conn.execute_batch(
        r#"
        INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at, description, is_favorite, default_tool_id)
        VALUES ('p1', '项目一', 'C:\proj\one', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, 1, 't1'),
               ('p2', '项目二', 'C:\proj\two', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL, NULL, 0, NULL);

        INSERT INTO tool_installations (id, tool_id, name, vendor, description, tool_type, source, executable_path, command_name, version, status, detection_method, is_custom, is_default, detected_at, last_error, created_at, updated_at)
        VALUES ('t1', 'cursor', 'Cursor', 'Anysphere', '', 'desktop', 'manual', 'C:\apps\Cursor\Cursor.exe', NULL, '0.1', 'detected', 'manual', 0, 1, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

        INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, created_at, updated_at, completed_at)
        VALUES ('k1', 'p1', '任务一', NULL, 'todo', 'medium', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

        INSERT INTO workspace_sessions (id, project_id, tool_id, task_id, label, restore_level, created_at, updated_at, last_used_at, last_restore_status, last_restore_error)
        VALUES ('s1', 'p1', 't1', 'k1', '上下文一', 'project', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL);

        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('theme', 'dark', '2026-01-01T00:00:00.000Z');
        "#,
    )
    .unwrap();
}

fn snapshot(conn: &rusqlite::Connection) -> Vec<(String, String)> {
    let mut rows = Vec::new();
    for (table, query) in [
        ("projects", "SELECT id || '|' || name || '|' || IFNULL(default_tool_id,'') FROM projects ORDER BY id"),
        ("tasks", "SELECT id || '|' || project_id || '|' || status FROM tasks ORDER BY id"),
        ("tool_installations", "SELECT id || '|' || tool_id || '|' || status FROM tool_installations ORDER BY id"),
        ("workspace_sessions", "SELECT id || '|' || project_id || '|' || IFNULL(tool_id,'') || '|' || IFNULL(task_id,'') FROM workspace_sessions ORDER BY id"),
        ("app_settings", "SELECT key || '|' || value FROM app_settings ORDER BY key"),
    ] {
        let mut statement = conn.prepare(query).unwrap();
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        for value in values {
            rows.push((table.to_string(), value));
        }
    }
    rows
}

fn open_db(workspace: &TempDir) -> (Database, PathBuf) {
    let path = workspace.path().join("vibeacross.db");
    let db = Database::open(path.clone()).unwrap();
    (db, path)
}

#[test]
fn backup_and_restore_round_trip_preserves_relations() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    {
        let conn = db.conn().unwrap();
        seed(&conn);
    }
    let before = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };

    let target = workspace.path().join("backup.vibeacross-backup");
    let info = db.create_backup(&target, false).unwrap();
    assert_eq!(info.counts.projects, 2);
    assert_eq!(info.counts.tasks, 1);
    assert_eq!(info.counts.tool_installations, 1);
    assert_eq!(info.counts.workspace_sessions, 1);
    assert_eq!(info.counts.settings, 1);
    assert_eq!(info.schema_version, migrations::latest_version());
    assert!(info.size_bytes > 0);
    assert!(info.file_name.ends_with(".vibeacross-backup"));

    // 变更数据：新增项目、删除任务与设置。
    {
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at, is_favorite) VALUES ('p3','项目三','C:\\proj\\three','2026-01-03T00:00:00.000Z','2026-01-03T00:00:00.000Z',0)",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM tasks WHERE id = 'k1'", []).unwrap();
        conn.execute("DELETE FROM app_settings WHERE key = 'theme'", []).unwrap();
    }

    let result = db.restore_from(&target).unwrap();
    assert!(Path::new(&result.protective_backup_path).exists());
    assert_eq!(result.counts.projects, 2);

    let after = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };
    assert_eq!(after, before, "恢复后数据应与备份时完全一致");

    // 关联完整性：项目默认工具、工作上下文的工具 / 任务引用仍然正确。
    {
        let conn = db.conn().unwrap();
        let default_tool: Option<String> = conn
            .query_row("SELECT default_tool_id FROM projects WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(default_tool.as_deref(), Some("t1"));

        let (project, tool, task): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT project_id, tool_id, task_id FROM workspace_sessions WHERE id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(project, "p1");
        assert_eq!(tool.as_deref(), Some("t1"));
        assert_eq!(task.as_deref(), Some("k1"));
    }
}

#[test]
fn empty_database_backup_and_restore_works() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    let target = workspace.path().join("empty.vibeacross-backup");

    let info = db.create_backup(&target, false).unwrap();
    assert_eq!(info.counts.projects, 0);

    let result = db.restore_from(&target).unwrap();
    assert_eq!(result.counts.projects, 0);

    let conn = db.conn().unwrap();
    assert_eq!(count(&conn, "projects"), 0);
    assert_eq!(count(&conn, "tasks"), 0);
}

#[test]
fn backup_captures_committed_wal_data_without_sidecars() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);

    {
        let conn = db.conn().unwrap();
        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal.to_lowercase(), "wal", "数据库应处于 WAL 模式");

        // 写大量数据，保持 WAL 未 checkpoint（不显式 checkpoint）。
        for index in 0..200 {
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, '2026-01-01T00:00:00.000Z')",
                rusqlite::params![format!("k{index}"), format!("v{index}")],
            )
            .unwrap();
        }
    }

    let target = workspace.path().join("wal.vibeacross-backup");
    let info = db.create_backup(&target, false).unwrap();
    assert_eq!(info.counts.settings, 200, "备份应包含 WAL 中已提交的数据");

    // 备份是单文件快照，不应残留 -wal / -shm 边车文件。
    for sidecar in backup::sidecar_paths(&target) {
        assert!(!sidecar.exists(), "备份不应产生边车文件 {}", sidecar.display());
    }
}

#[test]
fn inspect_rejects_non_database_and_empty_files() {
    let workspace = temp_dir();
    let not_db = workspace.path().join("notes.txt");
    fs::write(&not_db, b"this is not a database").unwrap();
    assert_eq!(
        backup::inspect_backup_file(&not_db).unwrap_err().code,
        "BACKUP_INVALID"
    );

    let empty = workspace.path().join("empty.vibeacross-backup");
    fs::write(&empty, b"").unwrap();
    assert_eq!(
        backup::inspect_backup_file(&empty).unwrap_err().code,
        "BACKUP_INVALID"
    );

    let missing = workspace.path().join("missing.vibeacross-backup");
    assert_eq!(
        backup::inspect_backup_file(&missing).unwrap_err().code,
        "BACKUP_NOT_FOUND"
    );
}

#[test]
fn inspect_rejects_corrupted_database() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    {
        let conn = db.conn().unwrap();
        seed(&conn);
        for index in 0..200 {
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, 'x', '2026-01-01T00:00:00.000Z')",
                rusqlite::params![format!("pad{index}")],
            )
            .unwrap();
        }
    }

    let good = workspace.path().join("good.vibeacross-backup");
    db.create_backup(&good, false).unwrap();

    // 保留文件头，破坏第 2 页及之后的内容，模拟磁盘损坏。
    let mut bytes = fs::read(&good).unwrap();
    assert!(bytes.len() > 4096);
    for byte in bytes.iter_mut().skip(4096) {
        *byte = 0;
    }
    let corrupt = workspace.path().join("corrupt.vibeacross-backup");
    fs::write(&corrupt, &bytes).unwrap();

    assert_eq!(
        backup::inspect_backup_file(&corrupt).unwrap_err().code,
        "BACKUP_CORRUPTED"
    );
}

#[test]
fn inspect_rejects_incompatible_version() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    let target = workspace.path().join("future.vibeacross-backup");
    db.create_backup(&target, false).unwrap();

    {
        let conn = rusqlite::Connection::open(&target).unwrap();
        conn.pragma_update(None, "user_version", migrations::latest_version() + 1)
            .unwrap();
    }

    assert_eq!(
        backup::inspect_backup_file(&target).unwrap_err().code,
        "BACKUP_INCOMPATIBLE"
    );
}

#[test]
fn backup_refuses_to_overwrite_without_confirmation() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    let target = workspace.path().join("dup.vibeacross-backup");
    fs::write(&target, b"existing").unwrap();

    assert_eq!(
        db.create_backup(&target, false).unwrap_err().code,
        "BACKUP_TARGET_EXISTS"
    );
    // 内容未被破坏。
    assert_eq!(fs::read(&target).unwrap(), b"existing");

    // 明确允许覆盖时成功，且写入的是真正可校验的备份。
    let info = db.create_backup(&target, true).unwrap();
    assert_eq!(info.counts.projects, 0);
    assert!(backup::inspect_backup_file(&target).is_ok());
}

#[test]
fn restore_rejects_invalid_file_without_touching_data() {
    let workspace = temp_dir();
    let (db, _) = open_db(&workspace);
    {
        let conn = db.conn().unwrap();
        seed(&conn);
    }
    let before = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };

    let bad = workspace.path().join("bad.vibeacross-backup");
    fs::write(&bad, b"definitely not a database").unwrap();

    let error = db.restore_from(&bad).unwrap_err();
    assert_eq!(error.code, "BACKUP_INVALID");

    let after = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };
    assert_eq!(after, before, "校验失败不得改动现有数据");
}

#[test]
fn restore_failure_after_swap_rolls_back_to_previous_data() {
    // 构造一个「能通过恢复前校验、但在重新打开 / 迁移时失败」的备份：
    // projects 表缺少 path 列，迁移创建唯一索引时会失败。
    let workspace = temp_dir();
    let crafted = workspace.path().join("crafted.vibeacross-backup");
    {
        let conn = rusqlite::Connection::open(&crafted).unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
    }
    // 该文件应能通过恢复前校验（是合法数据库、含必需表、版本 0）。
    assert!(backup::inspect_backup_file(&crafted).is_ok());

    let (db, _) = open_db(&workspace);
    {
        let conn = db.conn().unwrap();
        seed(&conn);
    }
    let before = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };

    let error = db.restore_from(&crafted).unwrap_err();
    assert_eq!(error.code, "RESTORE_FAILED");

    let after = {
        let conn = db.conn().unwrap();
        snapshot(&conn)
    };
    assert_eq!(after, before, "恢复失败必须回滚到操作前的数据");
    // 保护性备份应已保留。
    let protective: Vec<_> = fs::read_dir(workspace.path())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("vibeacross.pre-restore-")
        })
        .collect();
    assert_eq!(protective.len(), 1, "应保留一份保护性备份");
}

#[test]
fn suggested_file_name_uses_dedicated_extension() {
    let name = backup::suggested_file_name();
    assert!(name.starts_with("VibeAcross-"));
    assert!(name.ends_with(".vibeacross-backup"));
}
