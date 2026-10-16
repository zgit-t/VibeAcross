//! 阶段 05：全局搜索的集成测试。
//!
//! 只使用内存数据库与临时目录，不触碰真实系统；覆盖：项目 / 任务 / 工作上下文匹配、
//! 空查询、ASCII 大小写不敏感、LIKE 通配符转义、结果上限，以及**已删除 / 无效关联
//! 记录不会作为有效结果返回**。

use std::path::{Path, PathBuf};

use vibeacross_lib::db::Database;
use vibeacross_lib::projects;
use vibeacross_lib::search::{self, global_search};
use vibeacross_lib::tasks::{self, TaskInput, TaskPriority};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::workspace::{self, WorkspaceSessionInput};

/// 空检测器：既不认路径，也不解析命令；工作上下文创建时工具引用为空即可。
#[derive(Default)]
struct StubDetector;

impl Detector for StubDetector {
    fn file_exists(&self, _path: &Path) -> Result<bool, DetectError> {
        Ok(false)
    }

    fn resolve_command(&self, _name: &str) -> Option<PathBuf> {
        None
    }

    fn registry_installs(&self, _keywords: &[&str]) -> Vec<RegistryInstall> {
        Vec::new()
    }

    fn app_path(&self, _exe_name: &str) -> Option<PathBuf> {
        None
    }

    fn query_version(&self, _executable: &Path, _args: &[&str]) -> VersionOutcome {
        VersionOutcome::Unsupported
    }
}

fn memory_db() -> Database {
    Database::open_in_memory().expect("创建内存数据库失败")
}

fn new_task(project_id: &str, title: &str, description: Option<&str>) -> TaskInput {
    TaskInput {
        project_id: project_id.to_string(),
        title: title.to_string(),
        description: description.map(str::to_string),
        status: None,
        priority: TaskPriority::Medium,
        due_date: None,
    }
}

#[test]
fn empty_query_returns_no_results() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    projects::create_project(&conn, "Alpha", workspace.path().to_str().unwrap()).unwrap();

    let results = global_search(&conn, "   ", None).unwrap();
    assert!(results.query.is_empty());
    assert!(results.projects.is_empty());
    assert!(results.tasks.is_empty());
    assert!(results.sessions.is_empty());
}

#[test]
fn matches_projects_tasks_and_sessions_by_keyword() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();

    let project = projects::create_project(
        &conn,
        "Rocket App",
        workspace.path().to_str().unwrap(),
    )
    .unwrap();
    projects::update_description(&conn, &project.id, Some("面向火星的搜索演示".to_string()))
        .unwrap();

    tasks::create_task(
        &conn,
        new_task(&project.id, "Fix login flow", Some("broken session")),
    )
    .unwrap();

    let detector = StubDetector;
    workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project.id.clone(),
            tool_id: None,
            task_id: None,
            label: Some("morning routine".to_string()),
        },
    )
    .unwrap();

    // 项目名匹配，且备注字段也可命中。
    let by_name = global_search(&conn, "rocket", None).unwrap();
    assert_eq!(by_name.projects.len(), 1);
    assert_eq!(by_name.projects[0].id, project.id);
    assert!(by_name.tasks.is_empty());

    let by_description = global_search(&conn, "火星", None).unwrap();
    assert_eq!(by_description.projects.len(), 1);

    // 任务命中，并带出所属项目名称（用于导航）。
    let by_task = global_search(&conn, "login", None).unwrap();
    assert!(by_task.projects.is_empty());
    assert_eq!(by_task.tasks.len(), 1);
    assert_eq!(by_task.tasks[0].task.title, "Fix login flow");
    assert_eq!(by_task.tasks[0].project_name, "Rocket App");
    assert!(by_task.tasks[0].project_path_exists);

    // 工作上下文通过名称命中。
    let by_session = global_search(&conn, "morning", None).unwrap();
    assert_eq!(by_session.sessions.len(), 1);
    assert_eq!(by_session.sessions[0].project_id, project.id);
}

#[test]
fn search_is_case_insensitive_for_ascii() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    projects::create_project(&conn, "MixedCase", workspace.path().to_str().unwrap()).unwrap();

    assert_eq!(global_search(&conn, "mixedcase", None).unwrap().projects.len(), 1);
    assert_eq!(global_search(&conn, "MIXEDCASE", None).unwrap().projects.len(), 1);
}

#[test]
fn like_wildcards_are_matched_literally() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();

    projects::create_project(&conn, "a_b", workspace.path().to_str().unwrap()).unwrap();
    projects::create_project(&conn, "axb", workspace.path().to_str().unwrap()).unwrap();

    // 搜索 "a_b" 只应命中字面量 a_b，而不是把 "_" 当作任意单字符。
    let results = global_search(&conn, "a_b", None).unwrap();
    assert_eq!(results.projects.len(), 1);
    assert_eq!(results.projects[0].name, "a_b");

    // "%" 也不应作为通配符匹配到全部。
    assert!(global_search(&conn, "%", None).unwrap().projects.is_empty());
}

#[test]
fn results_are_capped_by_limit() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();

    for index in 0..5 {
        projects::create_project(
            &conn,
            &format!("Project {index}"),
            workspace.path().to_str().unwrap(),
        )
        .unwrap();
    }

    let limited = global_search(&conn, "project", Some(2)).unwrap();
    assert_eq!(limited.projects.len(), 2);

    let all = global_search(&conn, "project", Some(100)).unwrap();
    assert_eq!(all.projects.len(), 5);
}

#[test]
fn orphan_task_with_deleted_project_is_not_returned() {
    let db = memory_db();
    let conn = db.conn().unwrap();

    // 直接写入一条指向不存在项目的任务（模拟无效关联）。
    conn.execute(
        "INSERT INTO tasks \
         (id, project_id, title, description, status, priority, due_date, \
          created_at, updated_at, completed_at) \
         VALUES (?1, ?2, ?3, NULL, 'todo', 'medium', NULL, ?4, ?4, NULL)",
        rusqlite::params![
            "orphan-task",
            "missing-project",
            "orphansearchable",
            "2026-01-01T00:00:00.000Z"
        ],
    )
    .unwrap();

    let results = global_search(&conn, "orphansearchable", None).unwrap();
    assert!(results.tasks.is_empty());
}

#[test]
fn orphan_session_with_deleted_project_is_not_returned() {
    let db = memory_db();
    let conn = db.conn().unwrap();

    conn.execute(
        "INSERT INTO workspace_sessions \
         (id, project_id, tool_id, task_id, label, restore_level, created_at, \
          updated_at, last_used_at, last_restore_status, last_restore_error) \
         VALUES (?1, ?2, NULL, NULL, ?3, 'project', ?4, ?4, NULL, NULL, NULL)",
        rusqlite::params![
            "orphan-session",
            "missing-project",
            "orphanlabel",
            "2026-01-01T00:00:00.000Z"
        ],
    )
    .unwrap();

    let results = global_search(&conn, "orphanlabel", None).unwrap();
    assert!(results.sessions.is_empty());
}

#[test]
fn session_is_found_via_linked_task_title() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let workspace = tempfile::tempdir().unwrap();

    let project = projects::create_project(
        &conn,
        "LinkedApp",
        workspace.path().to_str().unwrap(),
    )
    .unwrap();
    let task = tasks::create_task(&conn, new_task(&project.id, "uniquetasktitle", None)).unwrap();

    let detector = StubDetector;
    workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project.id.clone(),
            tool_id: None,
            task_id: Some(task.id.clone()),
            label: None,
        },
    )
    .unwrap();

    let results = global_search(&conn, "uniquetasktitle", None).unwrap();
    assert_eq!(results.tasks.len(), 1);
    assert_eq!(results.sessions.len(), 1);
    assert_eq!(results.sessions[0].task_title.as_deref(), Some("uniquetasktitle"));
}

#[test]
fn normalize_and_limit_helpers() {
    assert_eq!(search::normalize_term("  x "), Some("x".to_string()));
    assert_eq!(search::normalize_term("  "), None);
    // 结果按类型分组，且不因空查询产生请求。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let results = global_search(&conn, "", None).unwrap();
    assert!(results.projects.is_empty() && results.tasks.is_empty());
}
