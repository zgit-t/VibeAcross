//! Phase 7：工作上下文的集成测试。
//!
//! 进程创建通过注入 `RecordingLauncher` 记录，不真正启动任何工具；
//! 覆盖创建 / 更新 / 删除、恢复成功与失败、任务与工具关联的完整性，
//! 以及各开发工具恢复能力的如实标注。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::launch::{
    self, LaunchError, LaunchGuard, LaunchMode, LaunchSpec, ProcessLauncher,
};
use vibeacross_lib::projects;
use vibeacross_lib::tasks::{self, TaskInput, TaskPriority};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::{
    LaunchMethod, RestoreLevel, SessionResumeSupport, ToolConfigInput,
};
use vibeacross_lib::tools::service as tools;
use vibeacross_lib::workspace::{self, WorkspaceSessionInput};

/// 记录启动请求的进程启动器；不产生真实进程。
#[derive(Default)]
struct RecordingLauncher {
    specs: Mutex<Vec<LaunchSpec>>,
    next_pid: Mutex<u32>,
}

impl RecordingLauncher {
    fn new() -> Self {
        Self {
            specs: Mutex::new(Vec::new()),
            next_pid: Mutex::new(5000),
        }
    }

    fn last(&self) -> LaunchSpec {
        self.specs
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("没有记录到启动请求")
    }

    fn count(&self) -> usize {
        self.specs.lock().unwrap().len()
    }
}

impl ProcessLauncher for RecordingLauncher {
    fn launch(&self, spec: &LaunchSpec) -> Result<u32, LaunchError> {
        self.specs.lock().unwrap().push(spec.clone());
        let mut pid = self.next_pid.lock().unwrap();
        *pid += 1;
        Ok(*pid)
    }
}

/// 只判断「文件是否存在」的检测器。
#[derive(Default)]
struct StubDetector {
    files: HashSet<String>,
}

impl StubDetector {
    fn new() -> Self {
        Self::default()
    }

    fn with_file(mut self, path: &str) -> Self {
        self.files.insert(normalize(path));
        self
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
        Ok(self.files.contains(&normalize(&path.to_string_lossy())))
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

fn stub_exe(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, b"stub").unwrap();
    path.to_string_lossy().into_owned()
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

/// 登记工具并返回安装配置 id。
fn add_tool(
    conn: &rusqlite::Connection,
    detector: &dyn Detector,
    input: ToolConfigInput,
) -> String {
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

fn import_project(conn: &rusqlite::Connection, dir: &Path) -> String {
    projects::import_project(conn, dir.to_str().unwrap(), None)
        .unwrap()
        .id
}

fn make_task(conn: &rusqlite::Connection, project_id: &str, title: &str) -> String {
    tasks::create_task(
        conn,
        TaskInput {
            project_id: project_id.to_string(),
            title: title.to_string(),
            description: None,
            status: None,
            priority: TaskPriority::Medium,
            due_date: None,
        },
    )
    .unwrap()
    .id
}

fn session_input(project_id: &str) -> WorkspaceSessionInput {
    WorkspaceSessionInput {
        project_id: project_id.to_string(),
        tool_id: None,
        task_id: None,
        label: None,
    }
}

#[test]
fn create_and_persist_workspace_session_survives_reopen() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db_path = workspace.path().join("data").join("vibeacross.db");

    let session_id = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project_id = import_project(&conn, &project_dir);
        let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
        let task_id = make_task(&conn, &project_id, "实现登录");

        let session = workspace::create_session(
            &conn,
            &detector,
            WorkspaceSessionInput {
                project_id: project_id.clone(),
                tool_id: Some(tool_id),
                task_id: Some(task_id),
                label: Some("登录功能".to_string()),
            },
        )
        .unwrap();
        assert_eq!(session.restore_level, RestoreLevel::Project);
        assert_eq!(session.tool_name.as_deref(), Some("Cursor"));
        assert_eq!(session.task_title.as_deref(), Some("实现登录"));
        assert!(session.project_path_exists);
        session.id
    };

    // 重新打开数据库（模拟应用重启）。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();
    let reloaded = workspace::get_session(&conn, &session_id).unwrap();
    assert_eq!(reloaded.label.as_deref(), Some("登录功能"));
    assert_eq!(reloaded.restore_level, RestoreLevel::Project);
    assert!(workspace::last_session(&conn).unwrap().is_some());
}

#[test]
fn create_validates_project_tool_and_task() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);

    let dir_a = workspace.path().join("a");
    let dir_b = workspace.path().join("b");
    std::fs::create_dir(&dir_a).unwrap();
    std::fs::create_dir(&dir_b).unwrap();
    let project_a = import_project(&conn, &dir_a);
    let project_b = import_project(&conn, &dir_b);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    // 未知项目。
    let missing = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: "nope".to_string(),
            tool_id: None,
            task_id: None,
            label: None,
        },
    )
    .unwrap_err();
    assert_eq!(missing.code, "PROJECT_NOT_FOUND");

    // 未知工具。
    let bad_tool = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_a.clone(),
            tool_id: Some("ghost".to_string()),
            task_id: None,
            label: None,
        },
    )
    .unwrap_err();
    assert_eq!(bad_tool.code, "TOOL_NOT_FOUND");

    // 任务不属于该项目。
    let task_b = make_task(&conn, &project_b, "别的任务");
    let mismatch = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_a.clone(),
            tool_id: None,
            task_id: Some(task_b),
            label: None,
        },
    )
    .unwrap_err();
    assert_eq!(mismatch.code, "WORKSPACE_TASK_MISMATCH");

    // 正常创建 + 已登记工具。
    let ok = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_a.clone(),
            tool_id: Some(tool_id),
            task_id: None,
            label: None,
        },
    )
    .unwrap();
    assert!(ok.tool_id.is_some());

    // 标签过长。
    let too_long = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_a,
            tool_id: None,
            task_id: None,
            label: Some("x".repeat(200)),
        },
    )
    .unwrap_err();
    assert_eq!(too_long.code, "WORKSPACE_LABEL_TOO_LONG");
}

#[test]
fn update_session_changes_tool_and_task() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe_a = stub_exe(workspace.path(), "Cursor.exe");
    let exe_b = stub_exe(workspace.path(), "Trae.exe");
    let detector = StubDetector::new().with_file(&exe_a).with_file(&exe_b);

    let dir = workspace.path().join("proj");
    std::fs::create_dir(&dir).unwrap();
    let project_id = import_project(&conn, &dir);
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &exe_a));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &exe_b));
    let task_id = make_task(&conn, &project_id, "任务");

    let session =
        workspace::create_session(&conn, &detector, session_input(&project_id)).unwrap();
    assert!(session.tool_id.is_none() && session.task_id.is_none());

    let updated = workspace::update_session(
        &conn,
        &detector,
        &session.id,
        WorkspaceSessionInput {
            project_id: project_id.clone(),
            tool_id: Some(cursor_id.clone()),
            task_id: Some(task_id.clone()),
            label: Some("  工作  ".to_string()),
        },
    )
    .unwrap();
    assert_eq!(updated.tool_id.as_deref(), Some(cursor_id.as_str()));
    assert_eq!(updated.task_id.as_deref(), Some(task_id.as_str()));
    assert_eq!(updated.label.as_deref(), Some("工作"));

    // 切换工具。
    let switched = workspace::update_session(
        &conn,
        &detector,
        &session.id,
        WorkspaceSessionInput {
            project_id,
            tool_id: Some(trae_id.clone()),
            task_id: None,
            label: None,
        },
    )
    .unwrap();
    assert_eq!(switched.tool_id.as_deref(), Some(trae_id.as_str()));
    assert!(switched.task_id.is_none());
}

#[test]
fn restore_session_launches_and_marks_success() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let session = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_id.clone(),
            tool_id: Some(tool_id),
            task_id: None,
            label: None,
        },
    )
    .unwrap();

    let outcome = workspace::restore_session(
        &conn,
        &launcher,
        &guard,
        &detector,
        &session.id,
        None,
    )
    .unwrap();
    assert_eq!(outcome.launch.method, LaunchMethod::FolderArgument);
    assert_eq!(outcome.session.last_restore_status, Some(workspace::RestoreStatus::Success));
    assert!(outcome.session.last_used_at.is_some());
    assert!(outcome.session.last_restore_error.is_none());

    let spec = launcher.last();
    assert_eq!(spec.mode, LaunchMode::Detached);
    assert_eq!(spec.args.len(), 1);
    let project = projects::get_project(&conn, &project_id).unwrap();
    assert_eq!(spec.args[0], project.path);
    assert_eq!(spec.working_dir, PathBuf::from(&project.path));
    assert_eq!(launcher.count(), 1);
}

#[test]
fn restore_failure_is_recorded_and_retryable() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let session = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id,
            tool_id: Some(tool_id),
            task_id: None,
            label: None,
        },
    )
    .unwrap();

    // 项目目录被删除 → 恢复失败，但记录保留并写入脱敏原因。
    std::fs::remove_dir(&project_dir).unwrap();
    let error =
        workspace::restore_session(&conn, &launcher, &guard, &detector, &session.id, None)
            .unwrap_err();
    assert_eq!(error.code, "PROJECT_PATH_MISSING");
    assert_eq!(launcher.count(), 0);

    let failed = workspace::get_session(&conn, &session.id).unwrap();
    assert_eq!(failed.last_restore_status, Some(workspace::RestoreStatus::Failed));
    assert_eq!(
        failed.last_restore_error.as_deref(),
        Some("项目目录不存在或不可访问")
    );
    // 失败原因不含绝对路径。
    assert!(!failed.last_restore_error.unwrap().contains('\\'));

    // 修复目录后可重试成功。
    std::fs::create_dir(&project_dir).unwrap();
    let retried =
        workspace::restore_session(&conn, &launcher, &guard, &detector, &session.id, None).unwrap();
    assert_eq!(
        retried.session.last_restore_status,
        Some(workspace::RestoreStatus::Success)
    );
    assert!(retried.session.last_restore_error.is_none());
    assert_eq!(launcher.count(), 1);
}

#[test]
fn restore_uses_override_then_project_default() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    // 会话本身未指定工具，项目默认工具已设置。
    launch::set_project_tool(&conn, &project_id, Some(&tool_id), &detector).unwrap();
    let session =
        workspace::create_session(&conn, &detector, session_input(&project_id)).unwrap();
    assert!(session.tool_id.is_none());

    let outcome =
        workspace::restore_session(&conn, &launcher, &guard, &detector, &session.id, None).unwrap();
    assert_eq!(outcome.launch.tool_id, tool_id);
    // 成功后把使用的工具写入会话。
    assert_eq!(outcome.session.tool_id.as_deref(), Some(tool_id.as_str()));

    // 恢复前切换工具：显式覆盖。
    let exe2 = stub_exe(workspace.path(), "Trae.exe");
    let detector2 = StubDetector::new().with_file(&exe).with_file(&exe2);
    let trae_id = add_tool(&conn, &detector2, tool_input("trae", &exe2));
    let switched = workspace::restore_session(
        &conn,
        &launcher,
        &guard,
        &detector2,
        &session.id,
        Some(&trae_id),
    )
    .unwrap();
    assert_eq!(switched.launch.tool_id, trae_id);
    assert_eq!(switched.session.tool_id.as_deref(), Some(trae_id.as_str()));
}

#[test]
fn repeated_restore_is_debounced_without_marking_failure() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let session = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id,
            tool_id: Some(tool_id),
            task_id: None,
            label: None,
        },
    )
    .unwrap();

    workspace::restore_session(&conn, &launcher, &guard, &detector, &session.id, None).unwrap();
    let duplicate =
        workspace::restore_session(&conn, &launcher, &guard, &detector, &session.id, None)
            .unwrap_err();
    assert_eq!(duplicate.code, "LAUNCH_DUPLICATE");
    assert_eq!(launcher.count(), 1, "重复点击不应产生第二个进程");

    // 防抖拒绝不应被标记为恢复失败。
    let after = workspace::get_session(&conn, &session.id).unwrap();
    assert_eq!(after.last_restore_status, Some(workspace::RestoreStatus::Success));
}

#[test]
fn removing_project_deletes_its_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();
    let dir = workspace.path().join("proj");
    std::fs::create_dir(&dir).unwrap();

    let project_id = import_project(&conn, &dir);
    let session =
        workspace::create_session(&conn, &detector, session_input(&project_id)).unwrap();

    projects::remove_project(&conn, &project_id).unwrap();
    let error = workspace::get_session(&conn, &session.id).unwrap_err();
    assert_eq!(error.code, "WORKSPACE_NOT_FOUND");
    assert!(workspace::list_sessions(&conn).unwrap().is_empty());
}

#[test]
fn deleting_task_and_tool_keeps_session_usable() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let dir = workspace.path().join("proj");
    std::fs::create_dir(&dir).unwrap();

    let project_id = import_project(&conn, &dir);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let task_id = make_task(&conn, &project_id, "任务");
    let session = workspace::create_session(
        &conn,
        &detector,
        WorkspaceSessionInput {
            project_id: project_id.clone(),
            tool_id: Some(tool_id.clone()),
            task_id: Some(task_id.clone()),
            label: None,
        },
    )
    .unwrap();

    // 删除任务 → 引用置空，会话仍可用。
    tasks::delete_task(&conn, &task_id).unwrap();
    let after_task = workspace::get_session(&conn, &session.id).unwrap();
    assert!(after_task.task_id.is_none());

    // 删除工具并清理引用 → 会话仍在，仅工具为空。
    tools::remove_tool(&conn, &tool_id).unwrap();
    launch::clear_tool_references(&conn, &tool_id).unwrap();
    let after_tool = workspace::get_session(&conn, &session.id).unwrap();
    assert!(after_tool.tool_id.is_none());
    assert_eq!(workspace::list_sessions(&conn).unwrap().len(), 1);
}

#[test]
fn restore_capability_is_reported_per_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();

    // 未安装的内置工具：不可恢复，会话恢复不支持。
    let state = tools::tool_state(&conn, &StubDetector::new()).unwrap();
    let trae = state.entries.iter().find(|e| e.tool_id == "trae").unwrap();
    assert_eq!(trae.restore.level, RestoreLevel::None);
    assert_eq!(trae.restore.session, SessionResumeSupport::Unsupported);

    // 已检测到的桌面工具：Level 1 可用，会话恢复不支持。
    let cursor_exe = stub_exe(workspace.path(), "Cursor.exe");
    let claude_exe = stub_exe(workspace.path(), "claude.exe");
    let wb_exe = stub_exe(workspace.path(), "WorkBuddy.exe");
    let detector = StubDetector::new()
        .with_file(&cursor_exe)
        .with_file(&claude_exe)
        .with_file(&wb_exe);
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &cursor_exe));
    let claude_id = add_tool(&conn, &detector, tool_input("claude-code", &claude_exe));
    let wb_id = add_tool(&conn, &detector, tool_input("workbuddy", &wb_exe));

    let state = tools::tool_state(&conn, &detector).unwrap();
    let by_id = |id: &str| state.entries.iter().find(|e| e.id == id).unwrap();

    let cursor = by_id(&cursor_id);
    assert_eq!(cursor.restore.level, RestoreLevel::Project);
    assert_eq!(cursor.restore.session, SessionResumeSupport::Unsupported);

    // Claude Code：有官方会话恢复命令，但尚未在本机验证 → 标注未验证。
    let claude = by_id(&claude_id);
    assert_eq!(claude.restore.level, RestoreLevel::Project);
    assert_eq!(
        claude.restore.session,
        SessionResumeSupport::DocumentedUnverified
    );

    // WorkBuddy：无法受控启动 → 不可恢复。
    let workbuddy = by_id(&wb_id);
    assert_eq!(workbuddy.restore.level, RestoreLevel::None);
    assert_eq!(workbuddy.restore.session, SessionResumeSupport::Unsupported);
}

#[test]
fn delete_session_removes_only_that_record() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();
    let project_id = import_project(&conn, &project_dir);

    let first = workspace::create_session(&conn, &detector, session_input(&project_id)).unwrap();
    let second = workspace::create_session(&conn, &detector, session_input(&project_id)).unwrap();

    workspace::delete_session(&conn, &first.id).unwrap();
    assert!(workspace::get_session(&conn, &first.id).is_err());

    let remaining = workspace::get_session(&conn, &second.id).unwrap();
    assert_eq!(remaining.project_id, project_id);

    // 再次删除同一条记录应报「未找到」，不会影响其它记录。
    let missing = workspace::delete_session(&conn, &first.id).unwrap_err();
    assert_eq!(missing.code, "WORKSPACE_NOT_FOUND");
}
