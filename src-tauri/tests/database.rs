use std::path::{Path, PathBuf};
use tempfile::TempDir;
use vibeacross_lib::db::Database;
use vibeacross_lib::migrations;
use vibeacross_lib::models::AppSettings;
use vibeacross_lib::tasks::{self, TaskInput, TaskPriority};
use vibeacross_lib::{projects, settings};

fn temp_dir() -> TempDir {
    tempfile::tempdir().expect("创建临时目录失败")
}

#[test]
fn migrations_apply_and_are_idempotent() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());

    // 再次执行迁移不应报错，也不应重复建表。
    migrations::run(&conn).unwrap();

    for table in [
        "projects",
        "app_settings",
        "tool_installations",
        "tasks",
        "workspace_sessions",
        "project_tools",
        "sessions",
    ] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "表 {table} 应存在且唯一");
    }

    // 版本 3 为 projects 增加了 default_tool_id 关联列。
    let has_column: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'default_tool_id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(has_column, 1, "projects 应包含 default_tool_id 列");

    // 版本 4 新增任务表；版本 5 新增工作上下文表；版本 6 移除活动表；
    // 版本 7 新增项目工具关联与会话表。
    for table in ["tasks", "workspace_sessions", "project_tools", "sessions"] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "表 {table} 应存在");
    }

    // 活动记录表已随功能移除，不应残留。
    let activity_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(activity_exists, 0, "activity_logs 表应已被移除");
}

#[test]
fn project_tool_migration_preserves_existing_projects() {
    // 手工构造一个「版本 2」的数据库：只有 projects / app_settings / tool_installations，
    // 且 projects 没有 default_tool_id 列，模拟升级前的真实数据。
    let workspace = temp_dir();
    let db_path = workspace.path().join("legacy.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute_batch(include_str!("../migrations/0001_init.sql"))
        .unwrap();
    conn.execute_batch(include_str!("../migrations/0002_tools.sql"))
        .unwrap();
    conn.pragma_update(None, "user_version", 2).unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at, description, is_favorite)
         VALUES ('p1', '遗留项目', 'C:\\legacy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, 1)",
        [],
    )
    .unwrap();

    migrations::run(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());

    // 旧数据保留，且新列默认为 NULL。
    let (name, tool): (String, Option<String>) = conn
        .query_row("SELECT name, default_tool_id FROM projects WHERE id = 'p1'", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!(name, "遗留项目");
    assert!(tool.is_none());
}

#[test]
fn workspace_migration_preserves_existing_v4_data() {
    // 手工构造一个「版本 4」的数据库：projects 已有 default_tool_id，
    // 且已存在任务与活动记录，模拟升级到最新版本前的真实数据。
    // 迁移到最新版本时应保留项目 / 任务，并移除仅活动功能使用的活动表。
    let workspace = temp_dir();
    let db_path = workspace.path().join("v4.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for sql in [
        include_str!("../migrations/0001_init.sql"),
        include_str!("../migrations/0002_tools.sql"),
        include_str!("../migrations/0003_project_tools.sql"),
        include_str!("../migrations/0004_tasks_activity.sql"),
    ] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", 4).unwrap();

    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at, description, is_favorite)
         VALUES ('p1', '既有项目', 'C:\\legacy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, created_at, updated_at, completed_at)
         VALUES ('t1', 'p1', '既有任务', NULL, 'todo', 'medium', NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO activity_logs (id, project_id, event_type, summary, created_at)
         VALUES ('a1', 'p1', 'project.created', '创建了项目', '2026-01-02T00:00:00.000Z')",
        [],
    )
    .unwrap();

    migrations::run(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());

    // 升级不破坏既有项目与任务数据。
    let project: String = conn
        .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(project, "既有项目");
    let task: String = conn
        .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(task, "既有任务");

    // 活动记录表已随功能移除，迁移后不再存在。
    let activity_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(activity_exists, 0, "升级后 activity_logs 表应已被移除");

    // 版本 5 的新表创建成功且为空。
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspace_sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(sessions, 0);

    // 版本 7 新增的项目工具关联与会话表也已创建且为空。
    for table in ["project_tools", "sessions"] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "表 {table} 应为空");
    }

    // 重复执行保持幂等。
    migrations::run(&conn).unwrap();
    let again: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(again, migrations::latest_version());
}

#[test]
fn current_tool_migration_backfills_associations() {
    // 构造一个「版本 7」的数据库：已有项目与工具安装，但「当前工具」尚未写入
    // 关联表（本次修复之前的真实数据）。
    let workspace = temp_dir();
    let db_path = workspace.path().join("v7.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for sql in [
        include_str!("../migrations/0001_init.sql"),
        include_str!("../migrations/0002_tools.sql"),
        include_str!("../migrations/0003_project_tools.sql"),
        include_str!("../migrations/0004_tasks_activity.sql"),
        include_str!("../migrations/0005_workspace_sessions.sql"),
        include_str!("../migrations/0006_drop_activity.sql"),
        include_str!("../migrations/0007_session_model.sql"),
    ] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", 7).unwrap();

    let now = "2026-01-01T00:00:00.000Z";
    for (id, tool) in [("tool-a", "cursor"), ("tool-b", "trae")] {
        conn.execute(
            "INSERT INTO tool_installations
                (id, tool_id, name, vendor, description, tool_type, source, status, is_custom, is_default, created_at, updated_at)
             VALUES (?1, ?2, ?2, '', '', 'cli', 'system', 'ready', 0, 0, ?3, ?3)",
            [id, tool, now],
        )
        .unwrap();
    }
    // p1：当前工具指向有效安装、但无关联 → 应补建关联。
    // p2：当前工具指向已不存在的工具 → 不应补建。
    // p3：已有与当前工具一致的关联 → 不应重复创建。
    for (id, path, tool) in [
        ("p1", "C:\\p1", "tool-a"),
        ("p2", "C:\\p2", "ghost-tool"),
        ("p3", "C:\\p3", "tool-b"),
    ] {
        conn.execute(
            "INSERT INTO projects
                (id, name, path, created_at, updated_at, description, is_favorite, default_tool_id)
             VALUES (?1, ?1, ?2, ?3, ?3, NULL, 0, ?4)",
            [id, path, now, tool],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
         VALUES ('pt3', 'p3', 'tool-b', ?1, ?1)",
        [now],
    )
    .unwrap();

    migrations::run(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());

    let count = |project: &str| -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM project_tools WHERE project_id = ?1",
            [project],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(count("p1"), 1, "p1 的当前工具应被补建为关联");
    assert_eq!(count("p2"), 0, "当前工具失效时不应补建关联");
    assert_eq!(count("p3"), 1, "已有的一致关联不应被重复创建");

    // 补建的关联确实指向该项目的当前工具。
    let bound_tool: String = conn
        .query_row(
            "SELECT tool_id FROM project_tools WHERE project_id = 'p1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(bound_tool, "tool-a");
}

#[test]
fn migration_rejects_newer_database_version() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    // 模拟一个由更高版本应用创建的数据库文件。
    conn.pragma_update(None, "user_version", 99).unwrap();

    let error = migrations::run(&conn).unwrap_err();
    assert_eq!(error.code, "DB_VERSION_UNSUPPORTED");
}

#[test]
fn create_project_creates_directory_and_record() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project = projects::create_project(
        &conn,
        "Demo App",
        &workspace.path().to_string_lossy(),
    )
    .unwrap();

    assert_eq!(project.name, "Demo App");
    assert!(project.path_exists);
    assert!(Path::new(&project.path).is_dir());
    assert!(project.path.ends_with("Demo App"));
    assert_eq!(project.created_at, project.updated_at);
    assert!(project.last_opened_at.is_none());

    let listed = projects::list_projects(&conn, "recent").unwrap();
    assert_eq!(listed.len(), 1);
}

#[test]
fn create_project_validates_name() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let location = workspace.path().to_string_lossy().into_owned();

    let empty = projects::create_project(&conn, "   ", &location).unwrap_err();
    assert_eq!(empty.code, "PROJECT_NAME_EMPTY");

    let invalid = projects::create_project(&conn, "bad/name", &location).unwrap_err();
    assert_eq!(invalid.code, "PROJECT_NAME_INVALID_CHAR");

    let reserved = projects::create_project(&conn, "CON", &location).unwrap_err();
    assert_eq!(reserved.code, "PROJECT_NAME_RESERVED");

    // 名称非法时不应在磁盘上留下残留目录。
    assert_eq!(std::fs::read_dir(workspace.path()).unwrap().count(), 0);
}

#[test]
fn create_project_requires_existing_location() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let error = projects::create_project(&conn, "Demo", "Z:\\definitely-missing-dir-xyz").unwrap_err();
    assert_eq!(error.code, "PATH_NOT_FOUND");
}

#[test]
fn create_project_rejects_existing_target() {
    let workspace = temp_dir();
    std::fs::create_dir(workspace.path().join("Taken")).unwrap();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let error = projects::create_project(&conn, "Taken", &workspace.path().to_string_lossy()).unwrap_err();
    assert_eq!(error.code, "TARGET_EXISTS");
}

#[test]
fn import_project_detects_duplicates_case_insensitively() {
    let existing = temp_dir();
    let real = existing.path().join("My Project");
    std::fs::create_dir(&real).unwrap();

    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project = projects::import_project(&conn, &real.to_string_lossy(), None).unwrap();
    assert_eq!(project.name, "My Project");

    // 同一路径重复导入应被拒绝。
    let duplicate = projects::import_project(&conn, &real.to_string_lossy(), None).unwrap_err();
    assert_eq!(duplicate.code, "PROJECT_DUPLICATE");

    // 大小写不同的同一路径同样视为重复（Windows 语义）。
    let upper = real.to_string_lossy().to_uppercase();
    let duplicate_upper = projects::import_project(&conn, &upper, None).unwrap_err();
    assert_eq!(duplicate_upper.code, "PROJECT_DUPLICATE");
}

#[test]
fn import_project_uses_custom_name_and_validates_missing_path() {
    let existing = temp_dir();
    let real = existing.path().join("folder-name");
    std::fs::create_dir(&real).unwrap();

    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::import_project(&conn, &real.to_string_lossy(), Some("Override".into())).unwrap();
    assert_eq!(project.name, "Override");

    let missing = projects::import_project(&conn, "Z:\\missing-xyz-123", None).unwrap_err();
    assert_eq!(missing.code, "PATH_NOT_FOUND");
}

#[test]
fn project_mutations_update_state() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::create_project(&conn, "Mutable", &workspace.path().to_string_lossy()).unwrap();

    let renamed = projects::rename_project(&conn, &project.id, "Renamed").unwrap();
    assert_eq!(renamed.name, "Renamed");

    let described =
        projects::update_description(&conn, &project.id, Some("  一些备注  ".into())).unwrap();
    assert_eq!(described.description.as_deref(), Some("一些备注"));

    let cleared = projects::update_description(&conn, &project.id, Some("   ".into())).unwrap();
    assert!(cleared.description.is_none());

    let favorite = projects::set_favorite(&conn, &project.id, true).unwrap();
    assert!(favorite.is_favorite);

    let touched = projects::touch_opened(&conn, &project.id).unwrap();
    assert!(touched.last_opened_at.is_some());

    let missing = projects::rename_project(&conn, "no-such-id", "x").unwrap_err();
    assert_eq!(missing.code, "PROJECT_NOT_FOUND");
}

#[test]
fn remove_project_only_removes_record() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::create_project(&conn, "ToRemove", &workspace.path().to_string_lossy()).unwrap();
    let project_dir = project.path.clone();

    projects::remove_project(&conn, &project.id).unwrap();
    assert!(projects::get_project(&conn, &project.id).is_err());

    // 磁盘目录不应被删除。
    assert!(Path::new(&project_dir).is_dir());

    let missing = projects::remove_project(&conn, &project.id).unwrap_err();
    assert_eq!(missing.code, "PROJECT_NOT_FOUND");
}

#[test]
fn remove_project_with_scope_keeps_dir_when_not_deleting() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::create_project(&conn, "KeepDir", &workspace.path().to_string_lossy()).unwrap();
    let project_dir = PathBuf::from(&project.path);

    projects::remove_project_with_scope(&conn, &project.id, false).unwrap();

    assert!(projects::get_project(&conn, &project.id).is_err());
    assert!(project_dir.is_dir(), "仅移除记录时磁盘目录应保留");
}

#[test]
fn remove_project_with_folder_deletes_only_target_dir() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::create_project(&conn, "DeleteMe", &workspace.path().to_string_lossy()).unwrap();
    let project_dir = PathBuf::from(&project.path);
    std::fs::write(project_dir.join("file.txt"), b"hello").unwrap();

    // 不属于该项目的同级目录（模拟工具原生数据）不应被删除。
    let sibling = workspace.path().join("native-session-data");
    std::fs::create_dir(&sibling).unwrap();
    std::fs::write(sibling.join("session.json"), b"{}").unwrap();

    projects::remove_project_with_scope(&conn, &project.id, true).unwrap();

    assert!(projects::get_project(&conn, &project.id).is_err(), "记录应被移除");
    assert!(!project_dir.exists(), "目标目录应被删除");
    assert!(sibling.join("session.json").is_file(), "其它目录不应被删除");
    assert!(workspace.path().is_dir(), "父目录不应被删除");
}

#[test]
fn remove_project_with_folder_does_not_touch_other_projects() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let target =
        projects::create_project(&conn, "Target", &workspace.path().to_string_lossy()).unwrap();
    let other =
        projects::create_project(&conn, "Other", &workspace.path().to_string_lossy()).unwrap();

    projects::remove_project_with_scope(&conn, &target.id, true).unwrap();

    assert!(projects::get_project(&conn, &target.id).is_err());
    assert!(projects::get_project(&conn, &other.id).is_ok(), "其它项目记录应保留");
    assert!(Path::new(&other.path).is_dir(), "其它项目目录应保留");
}

#[test]
fn delete_project_dir_rejects_unsafe_paths() {
    assert_eq!(
        projects::delete_project_dir("").unwrap_err().code,
        "PATH_EMPTY"
    );
    assert_eq!(
        projects::delete_project_dir("   ").unwrap_err().code,
        "PATH_EMPTY"
    );
    assert_eq!(
        projects::delete_project_dir("relative\\dir").unwrap_err().code,
        "PATH_NOT_ABSOLUTE"
    );

    // 磁盘根：只有盘符前缀与根组件，没有可删除的叶子目录。
    assert_eq!(
        projects::delete_project_dir("C:\\").unwrap_err().code,
        "PATH_UNSAFE_ROOT"
    );

    // 不存在的目录。
    let missing = temp_dir().path().join("does-not-exist");
    assert_eq!(
        projects::delete_project_dir(&missing.to_string_lossy())
            .unwrap_err()
            .code,
        "PATH_NOT_FOUND"
    );
}

#[test]
fn delete_project_dir_rejects_path_traversal() {
    let temp_root = temp_dir();
    let sub = temp_root.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    let real = temp_root.path().join("real");
    std::fs::create_dir(&real).unwrap();

    // 用 .. 让词法路径与解析后的真实路径不一致，应被拒绝且不删除任何内容。
    let traversal = format!("{}\\sub\\..\\real", temp_root.path().to_string_lossy());
    let error = projects::delete_project_dir(&traversal).unwrap_err();
    assert_eq!(error.code, "PROJECT_PATH_CHANGED");
    assert!(real.is_dir(), "拒绝后不应删除目录");
}

#[cfg(windows)]
#[test]
fn delete_project_dir_rejects_symlink_without_following() {
    use std::os::windows::fs::symlink_dir;

    let workspace = temp_dir();
    let real = workspace.path().join("real");
    std::fs::create_dir(&real).unwrap();
    std::fs::write(real.join("keep.txt"), b"keep").unwrap();

    let link = workspace.path().join("link");
    if symlink_dir(&real, &link).is_err() {
        // 创建符号链接需要开发者模式或相应权限，无法创建时跳过。
        return;
    }

    let error = projects::delete_project_dir(&link.to_string_lossy()).unwrap_err();
    assert_eq!(error.code, "PATH_IS_LINK");
    assert!(real.join("keep.txt").is_file(), "链接目标目录不应被删除");
}

#[test]
fn remove_project_with_folder_failure_keeps_record() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project =
        projects::create_project(&conn, "Broken", &workspace.path().to_string_lossy()).unwrap();

    // 把目录替换成同名文件，制造磁盘删除必然失败的场景。
    std::fs::remove_dir_all(&project.path).unwrap();
    std::fs::write(&project.path, b"not a dir").unwrap();

    let error = projects::remove_project_with_scope(&conn, &project.id, true).unwrap_err();
    assert_eq!(error.code, "PATH_NOT_DIR");
    assert!(
        projects::get_project(&conn, &project.id).is_ok(),
        "磁盘删除失败时应保留记录以便重试"
    );
}

#[test]
fn relocate_project_updates_path_and_blocks_conflicts() {
    let workspace = temp_dir();
    let dir_a = workspace.path().join("a");
    let dir_b = workspace.path().join("b");
    std::fs::create_dir(&dir_a).unwrap();
    std::fs::create_dir(&dir_b).unwrap();

    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let first = projects::import_project(&conn, &dir_a.to_string_lossy(), None).unwrap();
    let second = projects::import_project(&conn, &dir_b.to_string_lossy(), None).unwrap();

    let relocated =
        projects::relocate_project(&conn, &second.id, &dir_a.to_string_lossy()).unwrap_err();
    assert_eq!(relocated.code, "PROJECT_DUPLICATE");

    let missing = projects::relocate_project(&conn, &first.id, "Z:\\gone-xyz").unwrap_err();
    assert_eq!(missing.code, "PATH_NOT_FOUND");
}

#[test]
fn list_projects_supports_sorting() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let alpha = projects::create_project(&conn, "Alpha", &workspace.path().to_string_lossy()).unwrap();
    let beta = projects::create_project(&conn, "Beta", &workspace.path().to_string_lossy()).unwrap();
    projects::touch_opened(&conn, &beta.id).unwrap();

    let by_name = projects::list_projects(&conn, "name").unwrap();
    assert_eq!(by_name[0].name, "Alpha");

    // 最近访问优先：Beta 刚被访问，应排在最前。
    let by_recent = projects::list_projects(&conn, "recent").unwrap();
    assert_eq!(by_recent[0].id, beta.id);

    let by_created = projects::list_projects(&conn, "created").unwrap();
    assert!(by_created.iter().any(|p| p.id == alpha.id));
    assert!(by_created.iter().any(|p| p.id == beta.id));
}

#[test]
fn settings_roundtrip_and_validation() {
    let workspace = temp_dir();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let initial = settings::get_settings(&conn).unwrap();
    assert!(initial.default_project_folder.is_none());
    assert!(initial.theme.is_none());
    // 「显示最近的工作上下文」默认为开启（缺失即 true）。
    assert!(initial.show_last_context_on_startup);
    assert!(!initial.auto_restore_last_context);
    assert!(initial.language.is_none());

    let folder = workspace.path().to_string_lossy().into_owned();
    let saved = settings::update_settings(
        &conn,
        AppSettings {
            default_project_folder: Some(folder.clone()),
            theme: Some("dark".into()),
            show_last_context_on_startup: true,
            auto_restore_last_context: true,
            language: Some("en".into()),
            auto_update: false,
        },
    )
    .unwrap();
    assert_eq!(saved.theme.as_deref(), Some("dark"));
    assert!(saved.default_project_folder.is_some());
    assert!(saved.show_last_context_on_startup);
    assert!(saved.auto_restore_last_context);
    // 别名应规范化为标准标记。
    assert_eq!(saved.language.as_deref(), Some("en-US"));

    // 主题非法时整体拒绝，且不覆盖已有设置。
    let invalid = settings::update_settings(
        &conn,
        AppSettings {
            default_project_folder: Some("Z:\\missing-xyz".into()),
            theme: Some("neon".into()),
            show_last_context_on_startup: false,
            auto_restore_last_context: false,
            language: None,
            auto_update: false,
        },
    )
    .unwrap_err();
    assert_eq!(invalid.code, "PATH_NOT_FOUND");

    let unchanged = settings::get_settings(&conn).unwrap();
    assert_eq!(unchanged.theme.as_deref(), Some("dark"));

    // 传入空值应清除对应设置。
    let cleared = settings::update_settings(
        &conn,
        AppSettings {
            default_project_folder: None,
            theme: None,
            show_last_context_on_startup: false,
            auto_restore_last_context: false,
            language: None,
            auto_update: false,
        },
    )
    .unwrap();
    assert!(cleared.theme.is_none());
    assert!(cleared.default_project_folder.is_none());
    assert!(cleared.language.is_none());
    // 显式关闭会被持久化为 false（而非回落为默认的 true）。
    assert!(!cleared.show_last_context_on_startup);
}

#[test]
fn settings_rejects_invalid_language() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let invalid = settings::update_settings(
        &conn,
        AppSettings {
            default_project_folder: None,
            theme: None,
            show_last_context_on_startup: false,
            auto_restore_last_context: false,
            language: Some("fr-FR".into()),
            auto_update: false,
        },
    )
    .unwrap_err();
    assert_eq!(invalid.code, "SETTING_INVALID_LANGUAGE");

    // 非法值不应写入，语言保持未设置。
    let unchanged = settings::get_settings(&conn).unwrap();
    assert!(unchanged.language.is_none());
}

#[test]
fn tasks_and_settings_persist_across_reopen() {
    let data = temp_dir();
    let db_path = data.path().join("vibeacross.db");

    let (project_id, task_id) = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project =
            projects::create_project(&conn, "Persist", data.path().to_str().unwrap()).unwrap();
        let task = tasks::create_task(
            &conn,
            TaskInput {
                project_id: project.id.clone(),
                title: "持久化任务".to_string(),
                description: Some("重启后应仍然存在".to_string()),
                status: None,
                priority: TaskPriority::High,
                due_date: Some("2026-12-31".to_string()),
            },
        )
        .unwrap();
        settings::update_settings(
            &conn,
            AppSettings {
                default_project_folder: None,
                theme: Some("dark".to_string()),
                show_last_context_on_startup: true,
                auto_restore_last_context: true,
                language: Some("en-US".to_string()),
                auto_update: false,
            },
        )
        .unwrap();
        (project.id, task.id)
    };

    // 重新打开数据库（模拟应用重启），数据与关联应完整保留。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();

    let reloaded = tasks::get_task(&conn, &task_id).unwrap();
    assert_eq!(reloaded.project_id, project_id);
    assert_eq!(reloaded.title, "持久化任务");
    assert_eq!(reloaded.description.as_deref(), Some("重启后应仍然存在"));
    assert_eq!(reloaded.priority, TaskPriority::High);
    assert_eq!(reloaded.due_date.as_deref(), Some("2026-12-31"));

    let loaded = settings::get_settings(&conn).unwrap();
    assert_eq!(loaded.theme.as_deref(), Some("dark"));
    assert_eq!(loaded.language.as_deref(), Some("en-US"));
    assert!(loaded.auto_restore_last_context);
}

// --- 阶段 15：记忆系统迁移真实性核验 ---------------------------------------------

fn column_default(conn: &rusqlite::Connection, table: &str, column: &str) -> Option<String> {
    conn.query_row(
        "SELECT dflt_value FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |row| row.get(0),
    )
    .unwrap()
}

fn table_exists(conn: &rusqlite::Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

/// 从真实的「版本 8」（v1.3.1 发布库形态）升级：既有项目 / 工具安装 / 关联 / 会话
/// 必须保持不变，同时补齐记忆相关表与晋升字段。
#[test]
fn memory_migration_upgrades_v8_library_and_preserves_data() {
    let workspace = temp_dir();
    let db_path = workspace.path().join("v8.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for sql in [
        include_str!("../migrations/0001_init.sql"),
        include_str!("../migrations/0002_tools.sql"),
        include_str!("../migrations/0003_project_tools.sql"),
        include_str!("../migrations/0004_tasks_activity.sql"),
        include_str!("../migrations/0005_workspace_sessions.sql"),
        include_str!("../migrations/0006_drop_activity.sql"),
        include_str!("../migrations/0007_session_model.sql"),
        include_str!("../migrations/0008_project_current_tool.sql"),
    ] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", 8).unwrap();

    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO projects
            (id, name, path, created_at, updated_at, description, is_favorite, default_tool_id)
         VALUES ('p1', '既有项目', 'C:\\legacy', ?1, ?1, NULL, 0, 'tool-a')",
        [now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tool_installations
            (id, tool_id, name, vendor, description, tool_type, source, status, is_custom, is_default, created_at, updated_at)
         VALUES ('tool-a', 'opencode', 'OpenCode', '', '', 'cli', 'system', 'ready', 0, 1, ?1, ?1)",
        [now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
         VALUES ('pt1', 'p1', 'tool-a', ?1, ?1)",
        [now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sessions
            (id, project_tool_id, display_name, native_session_id, status, created_at, updated_at)
         VALUES ('s1', 'pt1', '既有会话', 'native-1', 'active', ?1, ?1)",
        [now],
    )
    .unwrap();

    migrations::run(&conn).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());
    assert_eq!(version, 13, "阶段 16 的发布库应迁移到版本 13");

    // 记忆相关表补齐。
    assert!(table_exists(&conn, "memory_files"), "memory_files 应被创建");
    assert!(
        table_exists(&conn, "memory_records"),
        "memory_records 应被创建"
    );
    assert!(
        table_exists(&conn, "memory_collection"),
        "memory_collection 应被创建"
    );
    assert!(
        table_exists(&conn, "native_session_claims"),
        "native_session_claims 应被创建"
    );
    assert!(
        table_exists(&conn, "context_reference_entries"),
        "context_reference_entries 应被创建"
    );

    // 晋升字段存在且默认值为 'none'；晋升索引存在。
    assert_eq!(
        column_default(&conn, "memory_records", "promotion_state").as_deref(),
        Some("'none'")
    );
    for column in ["promoted_at", "promotion_error"] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('memory_records') WHERE name = ?1",
                [column],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "memory_records 应包含 {column} 列");
    }
    let index: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_records_promotion'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index, 1, "晋升索引应存在");

    // 既有业务数据完整保留。
    let project_name: String = conn
        .query_row("SELECT name FROM projects WHERE id = 'p1'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(project_name, "既有项目");
    let native: String = conn
        .query_row(
            "SELECT native_session_id FROM sessions WHERE id = 's1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(native, "native-1");
    let tool: String = conn
        .query_row(
            "SELECT tool_id FROM project_tools WHERE id = 'pt1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tool, "tool-a");

    // 既有会话的原生标识被回填为「认领」，使升级后同路径重建项目不会误接管旧会话。
    let (claim_tool, claim_project): (String, String) = conn
        .query_row(
            "SELECT tool_id, project_id FROM native_session_claims
             WHERE native_session_id = 'native-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(claim_tool, "opencode");
    assert_eq!(claim_project, "p1");

    // 新表初始为空。
    for table in ["memory_files", "memory_records", "memory_collection"] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "{table} 初始应为空");
    }

    // 重复启动不重复执行迁移，数据不变。
    migrations::run(&conn).unwrap();
    let again: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(again, migrations::latest_version());
}

/// 全新数据库：一次性建到最新版本，并具备正确的默认值与索引。
#[test]
fn fresh_database_initializes_memory_schema_with_defaults() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, migrations::latest_version());

    for table in ["memory_files", "memory_records", "memory_collection"] {
        assert!(table_exists(&conn, table), "{table} 应存在");
    }
    assert_eq!(
        column_default(&conn, "memory_records", "promotion_state").as_deref(),
        Some("'none'")
    );

    // 插入一条不含晋升字段的记录：默认应为 none / 未晋升。
    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO memory_records
            (id, project_id, tool_id, native_session_id, record_kind, content_hash, dedup_key, collected_at, created_at, updated_at)
         VALUES ('r1', 'p1', 'opencode', 'n1', 'session_progress', 'h', 'd', ?1, ?1, ?1)",
        [now],
    )
    .unwrap_err(); // projects(p1) 不存在且外键开启时应被拒绝
    conn.execute(
        "INSERT INTO projects
            (id, name, path, created_at, updated_at, description, is_favorite)
         VALUES ('p1', 'P', 'C:\\p', ?1, ?1, NULL, 0)",
        [now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_records
            (id, project_id, tool_id, native_session_id, record_kind, content_hash, dedup_key, collected_at, created_at, updated_at)
         VALUES ('r1', 'p1', 'opencode', 'n1', 'session_progress', 'h', 'd', ?1, ?1, ?1)",
        [now],
    )
    .unwrap();
    let (state, promoted_at, error): (String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT promotion_state, promoted_at, promotion_error FROM memory_records WHERE id = 'r1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(state, "none");
    assert!(promoted_at.is_none());
    assert!(error.is_none());
    assert_eq!(column_default(&conn, "memory_records", "state").as_deref(), Some("'candidate'"));
}

/// 回填原生会话归属时，存在歧义的历史数据（同一 (工具, 原生会话) 同时挂在
/// 多个项目下）不得被静默认领给任意一个项目；无歧义的记录才回填。
#[test]
fn native_claims_backfill_ignores_ambiguous_history() {
    let workspace = temp_dir();
    let db_path = workspace.path().join("v11-ambiguous.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for sql in [
        include_str!("../migrations/0001_init.sql"),
        include_str!("../migrations/0002_tools.sql"),
        include_str!("../migrations/0003_project_tools.sql"),
        include_str!("../migrations/0004_tasks_activity.sql"),
        include_str!("../migrations/0005_workspace_sessions.sql"),
        include_str!("../migrations/0006_drop_activity.sql"),
        include_str!("../migrations/0007_session_model.sql"),
        include_str!("../migrations/0008_project_current_tool.sql"),
        include_str!("../migrations/0009_memory_files.sql"),
        include_str!("../migrations/0010_memory_records.sql"),
        include_str!("../migrations/0011_memory_promotion.sql"),
    ] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", 11).unwrap();

    let now = "2026-01-01T00:00:00.000Z";
    for id in ["p1", "p2"] {
        conn.execute(
            "INSERT INTO projects
                (id, name, path, created_at, updated_at, description, is_favorite)
             VALUES (?1, ?1, ?1, ?2, ?2, NULL, 0)",
            rusqlite::params![id, now],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO tool_installations
            (id, tool_id, name, vendor, description, tool_type, source, status, is_custom, is_default, created_at, updated_at)
         VALUES ('ti1', 'opencode', 'OpenCode', '', '', 'cli', 'system', 'ready', 0, 0, ?1, ?1)",
        [now],
    )
    .unwrap();
    for (id, project) in [("pt1", "p1"), ("pt2", "p2")] {
        conn.execute(
            "INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
             VALUES (?1, ?2, 'ti1', ?3, ?3)",
            rusqlite::params![id, project, now],
        )
        .unwrap();
    }
    // 同一原生会话同时挂在两个项目下（历史缺陷遗留的歧义数据）。
    conn.execute(
        "INSERT INTO sessions (id, project_tool_id, display_name, native_session_id, status, created_at, updated_at)
         VALUES ('s1', 'pt1', 'A 的会话', 'native-dup', 'active', ?1, ?1),
                ('s2', 'pt2', 'B 的会话', 'native-dup', 'active', ?1, ?1)",
        [now],
    )
    .unwrap();
    // 无歧义：只属于 p1。
    conn.execute(
        "INSERT INTO sessions (id, project_tool_id, display_name, native_session_id, status, created_at, updated_at)
         VALUES ('s3', 'pt1', '独有会话', 'native-solo', 'active', ?1, ?1)",
        [now],
    )
    .unwrap();

    migrations::run(&conn).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        migrations::latest_version()
    );

    // 歧义记录不得被静默认领给任意项目。
    let ambiguous: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM native_session_claims WHERE native_session_id = 'native-dup'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ambiguous, 0, "歧义的原生会话不应被静默认领");

    // 无歧义记录正常回填，且归属正确。
    let (tool, project): (String, String) = conn
        .query_row(
            "SELECT tool_id, project_id FROM native_session_claims
             WHERE native_session_id = 'native-solo'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(tool, "opencode");
    assert_eq!(project, "p1");

    // 原始会话数据一字未动。
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(sessions, 3);
}

/// 迁移失败时必须如实报错、事务回滚，且不留下半迁移的版本号或残表。
#[test]
fn failed_migration_reports_error_and_rolls_back_version() {
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    // 破坏前置条件：移除 memory_records，使 0011 的 ALTER TABLE 必然失败。
    conn.execute_batch("DROP TABLE memory_records").unwrap();
    conn.pragma_update(None, "user_version", 10).unwrap();

    let error = migrations::run(&conn).unwrap_err();
    assert_eq!(error.code, "MIGRATION_FAILED");

    // 版本号未被推进，失败的迁移未留下任何残表。
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 10, "失败的迁移不得推进版本号");
    assert!(!table_exists(&conn, "memory_records"), "失败迁移不应留下残表");
}
