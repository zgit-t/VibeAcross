//! 原生会话适配层的集成测试。
//!
//! 通过注入 `FakeBackend` 与 `RecordingLauncher`，在不接触真实工具、不产生任何
//! 真实进程的前提下，覆盖：能力矩阵的如实标注、创建后保存原生标识、保存失败时的
//! 补偿回滚、恢复前对原生会话存在性的校验、以及同步 / 重命名语义。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::error::AppError;
use vibeacross_lib::launch::{LaunchError, LaunchGuard, LaunchSpec, ProcessLauncher};
use vibeacross_lib::native::{
    self, capabilities_for, DeleteScope, NativeBackend, NativeCreateInput, NativeSessionInfo,
    SessionCapabilities, Support, SystemNativeBackend, ToolContext,
};
use vibeacross_lib::projects;
use vibeacross_lib::sessions::{self, SessionInput};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::ToolConfigInput;
use vibeacross_lib::tools::service as tools;

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

/// 内存中的原生会话后端，记录所有调用；不接触任何真实工具。
#[derive(Default)]
struct FakeBackend {
    create_id: Mutex<Option<String>>,
    existing: Mutex<HashSet<String>>,
    list_items: Mutex<Vec<NativeSessionInfo>>,
    deleted: Mutex<Vec<String>>,
    delete_error: Mutex<bool>,
    renames: Mutex<Vec<(String, String)>>,
    counter: Mutex<u32>,
    can_verify: Mutex<bool>,
}

impl FakeBackend {
    fn new() -> Self {
        Self {
            can_verify: Mutex::new(true),
            ..Self::default()
        }
    }

    fn set_create_id(&self, id: &str) {
        *self.create_id.lock().unwrap() = Some(id.to_string());
    }

    fn add_existing(&self, id: &str) {
        self.existing.lock().unwrap().insert(id.to_string());
    }

    fn set_list(&self, items: Vec<NativeSessionInfo>) {
        *self.list_items.lock().unwrap() = items;
    }

    fn set_can_verify(&self, value: bool) {
        *self.can_verify.lock().unwrap() = value;
    }

    fn deleted(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
    }

    fn set_delete_error(&self, value: bool) {
        *self.delete_error.lock().unwrap() = value;
    }

    fn renames(&self) -> Vec<(String, String)> {
        self.renames.lock().unwrap().clone()
    }
}

impl NativeBackend for FakeBackend {
    fn capabilities(&self, tool_id: &str) -> SessionCapabilities {
        capabilities_for(tool_id)
    }

    fn create(&self, ctx: &ToolContext, title: Option<&str>) -> Result<NativeSessionInfo, AppError> {
        let native_id = match self.create_id.lock().unwrap().clone() {
            Some(id) => id,
            None => {
                let mut counter = self.counter.lock().unwrap();
                *counter += 1;
                format!("native-{counter}")
            }
        };
        Ok(NativeSessionInfo {
            native_id,
            title: title.map(str::to_string),
            directory: Some(ctx.working_dir.to_string_lossy().into_owned()),
            created_at: None,
            updated_at: None,
        })
    }

    fn list(&self, _ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
        Ok(self.list_items.lock().unwrap().clone())
    }

    fn get(
        &self,
        _ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Option<NativeSessionInfo>, AppError> {
        if self.existing.lock().unwrap().contains(native_id) {
            Ok(Some(NativeSessionInfo {
                native_id: native_id.to_string(),
                title: None,
                directory: None,
                created_at: None,
                updated_at: None,
            }))
        } else {
            Ok(None)
        }
    }

    fn rename_title(
        &self,
        _ctx: &ToolContext,
        native_id: &str,
        title: &str,
    ) -> Result<(), AppError> {
        self.renames
            .lock()
            .unwrap()
            .push((native_id.to_string(), title.to_string()));
        Ok(())
    }

    fn delete(&self, _ctx: &ToolContext, native_id: &str) -> Result<(), AppError> {
        if *self.delete_error.lock().unwrap() {
            return Err(AppError::new(
                "NATIVE_DELETE_FAILED",
                "模拟删除原生会话失败。",
            ));
        }
        self.deleted.lock().unwrap().push(native_id.to_string());
        Ok(())
    }

    fn can_verify_exists(&self, _tool_id: &str) -> bool {
        *self.can_verify.lock().unwrap()
    }

    fn create_launch_args(
        &self,
        _ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError> {
        Ok(vec!["--session".to_string(), native_id.to_string()])
    }

    fn restore_launch_args(
        &self,
        _ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError> {
        Ok(vec!["--session".to_string(), native_id.to_string()])
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

fn stub_exe(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, b"stub").unwrap();
    path.to_string_lossy().into_owned()
}

fn make_dir(parent: &Path, name: &str) -> PathBuf {
    let dir = parent.join(name);
    std::fs::create_dir(&dir).unwrap();
    dir
}

fn add_tool(
    conn: &rusqlite::Connection,
    detector: &dyn Detector,
    tool_id: &str,
    path: &str,
) -> String {
    tools::add_tool(
        conn,
        detector,
        ToolConfigInput {
            tool_id: Some(tool_id.to_string()),
            name: None,
            tool_type: None,
            executable_path: Some(path.to_string()),
            command_name: None,
        },
    )
    .unwrap();
    tools::tool_state(conn, detector)
        .unwrap()
        .entries
        .iter()
        .find(|entry| entry.source != "builtin" && entry.tool_id == tool_id)
        .map(|entry| entry.id.clone())
        .expect("未找到刚登记的工具")
}

fn import_project(conn: &rusqlite::Connection, dir: &Path) -> String {
    projects::import_project(conn, dir.to_str().unwrap(), None)
        .unwrap()
        .id
}

fn create_input(project_id: &str, tool_id: &str, name: Option<&str>, launch: bool) -> NativeCreateInput {
    NativeCreateInput {
        project_id: project_id.to_string(),
        tool_id: tool_id.to_string(),
        display_name: name.map(str::to_string),
        launch,
    }
}

#[test]
fn capability_matrix_marks_unverified_as_not_verified() {
    let opencode = capabilities_for("opencode");
    assert_eq!(opencode.create, Support::Supported);
    assert_eq!(opencode.list, Support::Supported);
    assert_eq!(opencode.restore, Support::Supported);
    assert_eq!(opencode.native_id, Support::Supported);
    assert_eq!(opencode.delete, Support::Supported);

    let claude = capabilities_for("claude-code");
    assert_eq!(claude.create, Support::Supported);
    assert_eq!(claude.list, Support::Supported);
    assert_eq!(claude.restore, Support::Supported);
    assert_eq!(claude.native_id, Support::Supported);
    assert_eq!(claude.rename_title, Support::Unsupported);
    assert_eq!(claude.delete, Support::Unsupported);

    // 桌面类工具：只核实了「历史枚举」，其余能力一律如实标注为不支持。
    for tool_id in ["cursor", "trae", "workbuddy"] {
        let caps = capabilities_for(tool_id);
        assert_eq!(caps.list, Support::Supported, "{tool_id} 应支持只读枚举历史会话");
        assert_eq!(caps.native_id, Support::Supported, "{tool_id} 应提供原生会话标识");
        assert_eq!(caps.create, Support::Unsupported, "{tool_id} 不应声称支持创建");
        assert_eq!(caps.restore, Support::Unsupported, "{tool_id} 不应声称支持恢复");
        assert_eq!(caps.rename_title, Support::Unsupported, "{tool_id} 不应声称支持改名");
        assert_eq!(caps.delete, Support::Unsupported, "{tool_id} 不应声称支持删除");
        assert!(!caps.notes.trim().is_empty(), "{tool_id} 的能力说明不应为空");
    }

    // TRAE SOLO：本地会话数据库为加密格式，无法只读解析，所有能力一律如实标注为不支持。
    let solo = capabilities_for("trae-solo");
    for capability in [
        solo.create,
        solo.list,
        solo.restore,
        solo.native_id,
        solo.rename_title,
        solo.delete,
    ] {
        assert_eq!(
            capability,
            Support::Unsupported,
            "TRAE SOLO 不应声称支持任何原生会话能力"
        );
    }
    assert!(!solo.notes.trim().is_empty(), "TRAE SOLO 的能力说明不应为空");

    let unknown = capabilities_for("some-unknown-tool");
    assert_eq!(unknown.create, Support::NotVerified);
    assert_eq!(unknown.list, Support::NotVerified);
    assert_eq!(unknown.delete, Support::NotVerified);
}

#[test]
fn claude_list_reads_transcripts_under_config_dir_and_filters_by_cwd() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");

    // 构造受控的 Claude 配置目录，避免依赖真实用户数据。
    let config = workspace.path().join("claude-config");
    let encoded: String = project_dir
        .to_string_lossy()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let session_dir = config.join("projects").join(&encoded);
    std::fs::create_dir_all(&session_dir).unwrap();
    let session_id = "5f2a1b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    let cwd = project_dir.to_string_lossy().replace('\\', "\\\\");
    std::fs::write(
        session_dir.join(format!("{session_id}.jsonl")),
        format!(
            "{{\"type\":\"summary\",\"summary\":\"历史会话\"}}\n\
             {{\"sessionId\":\"{session_id}\",\"cwd\":\"{cwd}\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}}\n"
        ),
    )
    .unwrap();

    // 另一个项目的会话必须被排除。
    let other_dir = config.join("projects").join("C--Users-ZZZ");
    std::fs::create_dir_all(&other_dir).unwrap();
    std::fs::write(
        other_dir.join("other.jsonl"),
        "{\"sessionId\":\"other\",\"cwd\":\"C:\\\\Users\\\\ZZZ\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}\n",
    )
    .unwrap();

    let exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "claude-code", &exe);

    let previous = std::env::var_os("CLAUDE_CONFIG_DIR");
    std::env::set_var("CLAUDE_CONFIG_DIR", &config);
    let backend = SystemNativeBackend::new();
    let result = native::list_native(&conn, &backend, &detector, &project_id, &tool_id);
    match previous {
        Some(value) => std::env::set_var("CLAUDE_CONFIG_DIR", value),
        None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
    }

    let items = result.expect("枚举 Claude Code 历史会话失败");
    assert_eq!(items.len(), 1, "只应返回当前项目目录下的会话");
    assert_eq!(items[0].native_id, session_id);
    assert_eq!(items[0].title.as_deref(), Some("历史会话"));
}

#[test]
fn create_persists_native_id_and_launches_with_session_argument() {    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("实现登录"), true),
    )
    .unwrap();

    assert_eq!(outcome.session.display_name, "实现登录");
    assert_eq!(outcome.session.native_session_id.as_deref(), Some("native-1"));
    assert!(outcome.launch_error.is_none());
    assert!(outcome.launch.is_some());
    assert!(outcome.launch.as_ref().unwrap().context_initialized);
    assert_eq!(
        launcher.last().args,
        vec!["--session".to_string(), "native-1".to_string()]
    );

    let stored = sessions::get(&conn, &outcome.session.id).unwrap();
    assert_eq!(stored.native_session_id.as_deref(), Some("native-1"));
    assert!(stored.last_used_at.is_some());
}

#[test]
fn create_rolls_back_native_session_when_persistence_fails() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    // 预置一条占用该原生标识的记录，制造保存冲突。
    sessions::create(
        &conn,
        SessionInput {
            project_id: project_id.clone(),
            tool_id: tool_id.clone(),
            display_name: "已存在的会话".to_string(),
            native_session_id: Some("native-dup".to_string()),
            working_directory: None,
        },
    )
    .unwrap();

    let backend = FakeBackend::new();
    backend.set_create_id("native-dup");
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let error = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("重复尝试"), false),
    )
    .unwrap_err();

    assert_eq!(error.code, "NATIVE_SESSION_PERSIST_FAILED");
    assert_eq!(backend.deleted(), vec!["native-dup".to_string()]);
    // 未启动任何进程（launch: false 且创建失败）。
    assert_eq!(launcher.count(), 0);
}

#[test]
fn restore_requires_existing_native_session() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("登录重构"), false),
    )
    .unwrap();
    assert_eq!(launcher.count(), 0);

    // 原生会话不存在时：如实报错，且绝不启动（不静默新建）。
    let missing = native::restore(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        &outcome.session.id,
    )
    .unwrap_err();
    assert_eq!(missing.code, "NATIVE_SESSION_MISSING");
    assert_eq!(launcher.count(), 0);

    // 原生会话存在时：恢复并携带会话参数。
    backend.add_existing("native-1");
    let result = native::restore(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        &outcome.session.id,
    )
    .unwrap();
    assert!(result.context_initialized);
    assert_eq!(
        launcher.last().args,
        vec!["--session".to_string(), "native-1".to_string()]
    );
    assert_eq!(launcher.count(), 1);
}

#[test]
fn restore_skips_precheck_when_backend_cannot_verify_exists() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    // 用 opencode 工具登记以便复用 FakeBackend，但显式关闭其存在性查询能力。
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    backend.set_can_verify(false);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("无法预检"), false),
    )
    .unwrap();
    // 后端并未记录该会话「存在」，但关闭预检后仍应启动（缺失交给工具自身报告）。
    let result = native::restore(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        &outcome.session.id,
    )
    .unwrap();
    assert!(result.context_initialized);
    assert_eq!(launcher.count(), 1);
}

#[test]
fn restore_rejects_session_without_native_id() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let session = sessions::create(
        &conn,
        SessionInput {
            project_id,
            tool_id,
            display_name: "本地会话".to_string(),
            native_session_id: None,
            working_directory: None,
        },
    )
    .unwrap();

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let error = native::restore(&conn, &backend, &launcher, &guard, &detector, &session.id)
        .unwrap_err();
    assert_eq!(error.code, "SESSION_NO_NATIVE_ID");
    assert_eq!(launcher.count(), 0);
}

#[test]
fn sync_imports_native_sessions_idempotently() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    backend.set_list(vec![
        NativeSessionInfo {
            native_id: "ses_a".to_string(),
            title: Some("会话 A".to_string()),
            directory: None,
            created_at: None,
            updated_at: Some("2026-01-01T00:00:02Z".to_string()),
        },
        NativeSessionInfo {
            native_id: "ses_b".to_string(),
            title: None,
            directory: None,
            created_at: None,
            updated_at: Some("2026-01-01T00:00:01Z".to_string()),
        },
    ]);

    let first = native::sync(&conn, &backend, &detector, &project_id, &tool_id).unwrap();
    assert_eq!(first.sessions.len(), 2);
    let ids: HashSet<Option<String>> = first
        .sessions
        .iter()
        .map(|s| s.native_session_id.clone())
        .collect();
    assert!(ids.contains(&Some("ses_a".to_string())));
    assert!(ids.contains(&Some("ses_b".to_string())));

    // 幂等：再次同步不产生重复记录。
    let second = native::sync(&conn, &backend, &detector, &project_id, &tool_id).unwrap();
    assert_eq!(second.sessions.len(), 2);
    let listed = sessions::list(&conn, &Default::default()).unwrap();
    assert_eq!(listed.len(), 2);

    let native_list = native::list_native(&conn, &backend, &detector, &project_id, &tool_id).unwrap();
    assert_eq!(native_list.len(), 2);
}

#[test]
fn rename_updates_local_name_and_reports_native_flag() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("旧名字"), false),
    )
    .unwrap();

    // 仅改本地名：不同步原生标题。
    let local_only = native::rename(
        &conn,
        &backend,
        &detector,
        &outcome.session.id,
        "仅本地",
        false,
    )
    .unwrap();
    assert!(!local_only.native_renamed);
    assert_eq!(local_only.session.display_name, "仅本地");
    assert!(backend.renames().is_empty());

    // 同步原生标题：记录到后端并如实报告。
    let synced = native::rename(
        &conn,
        &backend,
        &detector,
        &outcome.session.id,
        "同步标题",
        true,
    )
    .unwrap();
    assert!(synced.native_renamed);
    assert_eq!(synced.session.display_name, "同步标题");
    assert_eq!(
        backend.renames(),
        vec![("native-1".to_string(), "同步标题".to_string())]
    );
}

#[test]
fn delete_removes_native_session_then_local_record() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("待删除"), false),
    )
    .unwrap();
    // 让存在性预检确认该原生会话仍在工具中。
    backend.add_existing("native-1");

    let outcome =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Both)
            .unwrap();
    assert_eq!(outcome.scope, DeleteScope::Both);
    assert!(outcome.native_deleted);
    assert!(!outcome.native_already_gone);
    assert!(outcome.local_deleted);
    assert_eq!(backend.deleted(), vec!["native-1".to_string()]);
    // 原生删除成功后才清理本地记录。
    assert!(sessions::get(&conn, &created.session.id).is_err());
}

#[test]
fn delete_rejects_tool_without_native_delete_and_keeps_record() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "claude-code", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("仅本地"), false),
    )
    .unwrap();

    let error =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Both)
            .unwrap_err();
    assert_eq!(error.code, "NATIVE_DELETE_UNSUPPORTED");
    // 绝不静默退化为只删本地记录。
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &created.session.id).is_ok());
}

#[test]
fn delete_keeps_local_record_when_native_delete_fails() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("删除失败"), false),
    )
    .unwrap();
    backend.add_existing("native-1");
    backend.set_delete_error(true);

    let error =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Both)
            .unwrap_err();
    assert_eq!(error.code, "NATIVE_DELETE_FAILED");
    assert!(backend.deleted().is_empty());
    // 原生删除失败 → 本地记录保持不变，避免状态不一致。
    assert!(sessions::get(&conn, &created.session.id).is_ok());
}

#[test]
fn delete_treats_absent_native_as_deleted_and_cleans_record() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("已不存在"), false),
    )
    .unwrap();
    // 不加入 existing：预检将确认工具中已不存在该原生会话。

    let outcome =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Both)
            .unwrap();
    assert!(outcome.native_deleted);
    assert!(outcome.native_already_gone);
    assert!(outcome.local_deleted);
    // 可可靠确认已不存在 → 不对工具执行删除，但仍清理本地记录。
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &created.session.id).is_err());
}

#[test]
fn delete_rejects_session_without_native_id() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let session = sessions::create(
        &conn,
        SessionInput {
            project_id,
            tool_id,
            display_name: "本地会话".to_string(),
            native_session_id: None,
            working_directory: None,
        },
    )
    .unwrap();

    let backend = FakeBackend::new();
    let error =
        native::delete_session(&conn, &backend, &detector, &session.id, DeleteScope::Native)
            .unwrap_err();
    assert_eq!(error.code, "SESSION_NO_NATIVE_ID");
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &session.id).is_ok());
}

#[test]
fn delete_local_only_removes_record_and_leaves_native_untouched() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("仅本地"), false),
    )
    .unwrap();
    backend.add_existing("native-1");

    let outcome =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Local)
            .unwrap();
    assert_eq!(outcome.scope, DeleteScope::Local);
    assert!(!outcome.native_deleted);
    assert!(outcome.local_deleted);
    // 只删本地：绝不调用原生删除。
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &created.session.id).is_err());
}

#[test]
fn delete_local_only_works_even_when_tool_has_no_native_delete() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "claude-code", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("仅本地"), false),
    )
    .unwrap();

    let outcome =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Local)
            .unwrap();
    assert!(outcome.local_deleted);
    assert!(!outcome.native_deleted);
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &created.session.id).is_err());
}

#[test]
fn delete_native_only_keeps_local_record() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("仅原生"), false),
    )
    .unwrap();
    backend.add_existing("native-1");

    let outcome =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Native)
            .unwrap();
    assert_eq!(outcome.scope, DeleteScope::Native);
    assert!(outcome.native_deleted);
    assert!(!outcome.local_deleted);
    assert_eq!(backend.deleted(), vec!["native-1".to_string()]);
    // 仅删原生：本地记录必须保留。
    assert!(sessions::get(&conn, &created.session.id).is_ok());
}

#[test]
fn delete_native_only_rejects_unsupported_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "claude-code", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let created = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, Some("仅原生"), false),
    )
    .unwrap();

    let error =
        native::delete_session(&conn, &backend, &detector, &created.session.id, DeleteScope::Native)
            .unwrap_err();
    assert_eq!(error.code, "NATIVE_DELETE_UNSUPPORTED");
    assert!(backend.deleted().is_empty());
    assert!(sessions::get(&conn, &created.session.id).is_ok());
}
