//! 阶段 04：项目健康检查与路径修复的集成测试。
//!
//! 工具检测通过注入 `StubDetector` 控制，不触碰真实系统；项目目录使用临时目录，
//! 覆盖：有效路径、无效路径（缺失 / 非目录）、权限分类、工具缺失 / 失效 / 不受支持，
//! 以及路径改变不影响项目关联数据。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::health::{inspect_path, project_health, PathStatus, ToolHealthStatus};
use vibeacross_lib::projects;
use vibeacross_lib::shell;
use vibeacross_lib::tasks::{self, TaskInput, TaskPriority};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::ToolConfigInput;
use vibeacross_lib::tools::service as tools;
use vibeacross_lib::workspace::{self, WorkspaceSessionInput};

/// 只判断「文件是否存在」的检测器，可由测试动态增删文件。
#[derive(Default)]
struct StubDetector {
    files: Mutex<HashSet<String>>,
}

impl StubDetector {
    fn new() -> Self {
        Self::default()
    }

    fn with_file(self, path: &str) -> Self {
        self.files.lock().unwrap().insert(normalize(path));
        self
    }

    fn add_file(&self, path: &str) {
        self.files.lock().unwrap().insert(normalize(path));
    }
}

fn normalize(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_ascii_lowercase()
}

impl Detector for StubDetector {
    fn file_exists(&self, path: &Path) -> Result<bool, DetectError> {
        Ok(self.files.lock().unwrap().contains(&normalize(&path.to_string_lossy())))
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

fn tool_input(tool_id: &str, path: &str) -> ToolConfigInput {
    ToolConfigInput {
        tool_id: Some(tool_id.to_string()),
        name: None,
        tool_type: None,
        executable_path: Some(path.to_string()),
        command_name: None,
    }
}

/// 登记一个工具并返回其安装配置 id。
fn add_tool(conn: &rusqlite::Connection, detector: &dyn Detector, input: ToolConfigInput) -> String {
    let tool_id = input.tool_id.clone();
    tools::add_tool(conn, detector, input).unwrap();
    tools::tool_state(conn, detector)
        .unwrap()
        .entries
        .iter()
        .find(|entry| {
            entry.source != "builtin"
                && tool_id
                    .as_deref()
                    .map(|id| entry.tool_id == id)
                    .unwrap_or(false)
        })
        .map(|entry| entry.id.clone())
        .expect("未找到刚登记的工具")
}

#[test]
fn inspect_path_classifies_valid_missing_and_non_directory() {
    let workspace = tempfile::tempdir().unwrap();

    // 有效目录。
    assert_eq!(inspect_path(workspace.path()), PathStatus::Ok);

    // 不存在的路径（在临时目录内构造一个绝不会被创建的子路径）。
    let missing = workspace.path().join("does-not-exist");
    assert_eq!(inspect_path(&missing), PathStatus::Missing);

    // 指向文件而非目录。
    let file = workspace.path().join("a-file.txt");
    std::fs::write(&file, b"data").unwrap();
    assert_eq!(inspect_path(&file), PathStatus::NotDirectory);

    // 路径中段是文件（无法作为目录解析）时绝不报告为 Ok。
    let nested = file.join("child");
    assert_ne!(inspect_path(&nested), PathStatus::Ok);
}

#[test]
fn health_reports_ok_path_without_default_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "Healthy", workspace.path().to_str().unwrap()).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.path_status, PathStatus::Ok);
    assert_eq!(health.tool_status, ToolHealthStatus::NotConfigured);
    assert!(health.tool_id.is_none());
}

#[test]
fn health_reports_missing_directory() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "Gone", workspace.path().to_str().unwrap()).unwrap();
    // 目录被移动 / 删除后，健康检查必须如实报告缺失。
    std::fs::remove_dir_all(&project.path).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.path_status, PathStatus::Missing);
}

#[test]
fn health_reports_non_directory_path() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "WasDir", workspace.path().to_str().unwrap()).unwrap();
    // 用同名文件替换原目录，模拟「路径指向非目录对象」。
    std::fs::remove_dir_all(&project.path).unwrap();
    std::fs::write(&project.path, b"now a file").unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.path_status, PathStatus::NotDirectory);
}

#[test]
fn health_reports_missing_tool_configuration() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    // 关联一个不存在的工具配置 id（例如配置已被移除）。
    projects::set_default_tool(&conn, &project.id, Some("no-such-tool")).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.path_status, PathStatus::Ok);
    assert_eq!(health.tool_status, ToolHealthStatus::Missing);
    assert_eq!(health.tool_id.as_deref(), Some("no-such-tool"));
}

#[test]
fn health_reports_unavailable_tool_when_path_missing() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    // 手动登记一个路径不存在的工具 → 状态为 PathMissing → 不可用。
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", r"C:\apps\Cursor\Cursor.exe"));
    projects::set_default_tool(&conn, &project.id, Some(&cursor_id)).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.tool_status, ToolHealthStatus::Unavailable);
}

#[test]
fn health_reports_not_launchable_for_unsafe_script() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    // 已检测到但路径含无法安全转义的字符 → 不能受控启动。
    let detector = StubDetector::new().with_file(r"C:\npm\bad%tool.cmd");

    let project =
        projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    let opencode_id = add_tool(&conn, &detector, tool_input("opencode", r"C:\npm\bad%tool.cmd"));
    projects::set_default_tool(&conn, &project.id, Some(&opencode_id)).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.tool_status, ToolHealthStatus::NotLaunchable);
}

#[test]
fn health_reports_ready_tool_for_supported_install() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(r"C:\apps\Cursor\Cursor.exe");

    let project =
        projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", r"C:\apps\Cursor\Cursor.exe"));
    projects::set_default_tool(&conn, &project.id, Some(&cursor_id)).unwrap();

    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.tool_status, ToolHealthStatus::Ready);
}

#[test]
fn recheck_revalidates_default_tool_path() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let path = r"C:\apps\Cursor\Cursor.exe";
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", path));
    projects::set_default_tool(&conn, &project.id, Some(&cursor_id)).unwrap();

    // 路径失效时不可用。
    let before = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(before.tool_status, ToolHealthStatus::Unavailable);

    // 路径恢复后，重新检查（revalidate）应更新为可启动，而不触发全量检测。
    detector.add_file(path);
    let after = project_health(&conn, &project.id, &detector, true).unwrap();
    assert_eq!(after.tool_status, ToolHealthStatus::Ready);
}

#[test]
fn relocate_updates_path_without_losing_tasks_or_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let dir_b = workspace.path().join("new-location");
    std::fs::create_dir(&dir_b).unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project =
        projects::create_project(&conn, "Movable", workspace.path().to_str().unwrap()).unwrap();
    let original_path = project.path.clone();
    // 在原始目录内放置一个文件，重定位后不得被移动或删除。
    std::fs::write(Path::new(&original_path).join("keep.txt"), b"keep").unwrap();

    tasks::create_task(
        &conn,
        TaskInput {
            project_id: project.id.clone(),
            title: "关联任务".to_string(),
            description: None,
            status: None,
            priority: TaskPriority::Medium,
            due_date: None,
        },
    )
    .unwrap();
    workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project.id.clone(),
            tool_id: None,
            task_id: None,
            label: Some("上下文".to_string()),
        },
    )
    .unwrap();

    let relocated =
        projects::relocate_project(&conn, &project.id, dir_b.to_str().unwrap()).unwrap();
    assert_ne!(relocated.path, original_path);
    assert!(Path::new(&relocated.path).is_dir());

    // 目录内容未被移动 / 复制 / 删除。
    assert!(Path::new(&original_path).join("keep.txt").is_file());

    // 任务与工作上下文仍然关联同一项目。
    let query = tasks::TaskQuery {
        project_id: Some(project.id.clone()),
        ..Default::default()
    };
    let task_list = tasks::list_tasks(&conn, &query).unwrap();
    assert_eq!(task_list.len(), 1);
    let sessions = workspace::list_sessions(&conn).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].project_id, project.id);

    // 重定位后路径健康。
    let health = project_health(&conn, &project.id, &detector, false).unwrap();
    assert_eq!(health.path_status, PathStatus::Ok);
}

#[test]
fn open_directory_rejects_missing_path() {
    // 受控「打开目录」在路径不存在时返回明确错误，不启动任何进程。
    let error = shell::open_directory(Path::new("Z:\\definitely-missing-dir-vibeacross")).unwrap_err();
    assert_eq!(error.code, "PROJECT_PATH_MISSING");
}
