use std::path::Path;
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
