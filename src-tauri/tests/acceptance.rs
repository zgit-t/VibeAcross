//! 会话功能端到端验收测试（阶段 06）。
//!
//! 通过注入 `FakeBackend` 与 `RecordingLauncher`，在不接触真实工具、不产生真实
//! 进程的前提下，按用户流程层面验证：项目 × 工具 × 会话的归属隔离、创建 / 恢复 /
//! 改名语义、跨项目隔离、篡改 id 的拒绝、项目目录缺失、工具未安装 / 未就绪、
//! 重复原生标识等异常场景。
//!
//! 关键不变量（不得被放宽）：
//!  - 会话归属由后端据本地记录解析，绝不信任前端传入的工具 / 项目 id；
//!  - 工具未真实创建会话前，不写入本地记录；
//!  - 恢复必须指向记录的同一个原生会话，绝不静默新建；
//!  - 一个项目 / 工具的会话绝不会出现在另一个项目 / 工具之下。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::error::AppError;
use vibeacross_lib::launch::{LaunchError, LaunchGuard, LaunchSpec, ProcessLauncher};
use vibeacross_lib::native::{
    self, capabilities_for, NativeBackend, NativeCreateInput, NativeSessionInfo,
    SessionCapabilities, ToolContext,
};
use vibeacross_lib::project_tools;
use vibeacross_lib::projects;
use vibeacross_lib::sessions::{self, SessionInput, SessionQuery};
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::ToolConfigInput;
use vibeacross_lib::tools::service as tools;

/// 记录启动请求的进程启动器；不产生真实进程。
#[derive(Default)]
struct RecordingLauncher {
    specs: Mutex<Vec<LaunchSpec>>,
}

impl RecordingLauncher {
    fn new() -> Self {
        Self::default()
    }

    fn specs(&self) -> Vec<LaunchSpec> {
        self.specs.lock().unwrap().clone()
    }

    fn last(&self) -> LaunchSpec {
        self.specs()
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
        Ok(7000)
    }
}

/// 内存中的原生会话后端，记录所有调用；不接触任何真实工具。
#[derive(Default)]
struct FakeBackend {
    existing: Mutex<HashSet<String>>,
    created: Mutex<Vec<String>>,
    deleted: Mutex<Vec<String>>,
    renames: Mutex<Vec<(String, String)>>,
    list_items: Mutex<Vec<NativeSessionInfo>>,
    counter: Mutex<u32>,
    can_verify: Mutex<bool>,
    forced_id: Mutex<Option<String>>,
}

impl FakeBackend {
    fn new() -> Self {
        Self {
            can_verify: Mutex::new(true),
            ..Self::default()
        }
    }

    fn add_existing(&self, id: &str) {
        self.existing.lock().unwrap().insert(id.to_string());
    }

    /// 强制下一次创建返回固定标识（用于模拟「同一原生会话被重复关联」）。
    fn force_next_id(&self, id: &str) {
        *self.forced_id.lock().unwrap() = Some(id.to_string());
    }

    fn created(&self) -> Vec<String> {
        self.created.lock().unwrap().clone()
    }

    fn deleted(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
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
        let native_id = if let Some(id) = self.forced_id.lock().unwrap().clone() {
            id
        } else {
            let mut counter = self.counter.lock().unwrap();
            *counter += 1;
            format!("native-{counter}")
        };
        self.created.lock().unwrap().push(native_id.clone());
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

    fn get(&self, _ctx: &ToolContext, native_id: &str) -> Result<Option<NativeSessionInfo>, AppError> {
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

    fn rename_title(&self, _ctx: &ToolContext, native_id: &str, title: &str) -> Result<(), AppError> {
        self.renames
            .lock()
            .unwrap()
            .push((native_id.to_string(), title.to_string()));
        Ok(())
    }

    fn delete(&self, _ctx: &ToolContext, native_id: &str) -> Result<(), AppError> {
        self.deleted.lock().unwrap().push(native_id.to_string());
        Ok(())
    }

    fn can_verify_exists(&self, _tool_id: &str) -> bool {
        *self.can_verify.lock().unwrap()
    }

    fn create_launch_args(&self, _ctx: &ToolContext, native_id: &str) -> Result<Vec<String>, AppError> {
        Ok(vec!["--session".to_string(), native_id.to_string()])
    }

    fn restore_launch_args(&self, _ctx: &ToolContext, native_id: &str) -> Result<Vec<String>, AppError> {
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

fn import_project(conn: &rusqlite::Connection, dir: &Path) -> String {
    projects::import_project(conn, dir.to_str().unwrap(), None)
        .unwrap()
        .id
}

fn add_tool(conn: &rusqlite::Connection, detector: &dyn Detector, tool_id: &str, path: &str) -> String {
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

fn create_input(project_id: &str, tool_id: &str, name: &str, launch: bool) -> NativeCreateInput {
    NativeCreateInput {
        project_id: project_id.to_string(),
        tool_id: tool_id.to_string(),
        display_name: Some(name.to_string()),
        launch,
    }
}

/// 核心流程：项目 A 关联工具 X、Y；X 下建 X1/X2；Y 下建 Y1；
/// 切换工具只能看到各自会话；恢复 X1 指向的正是原生会话 X1。
#[test]
fn core_flow_isolates_sessions_per_tool_and_restores_target() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let opencode_exe = stub_exe(workspace.path(), "opencode.exe");
    let claude_exe = stub_exe(workspace.path(), "claude.exe");
    let detector = StubDetector::new()
        .with_file(&opencode_exe)
        .with_file(&claude_exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    // 1) 创建项目 A。
    let project_a = import_project(&conn, &project_dir);

    // 2) 为项目 A 关联工具 X（opencode）与工具 Y（claude-code）。
    let tool_x = add_tool(&conn, &detector, "opencode", &opencode_exe);
    let tool_y = add_tool(&conn, &detector, "claude-code", &claude_exe);
    project_tools::ensure(&conn, &project_a, &tool_x).unwrap();
    project_tools::ensure(&conn, &project_a, &tool_y).unwrap();

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    // 3) 工具 X 创建会话 X1、X2。
    let x1 = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_a, &tool_x, "X1", false),
    )
    .unwrap();
    let x2 = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_a, &tool_x, "X2", false),
    )
    .unwrap();

    // 4) 工具 Y 创建会话 Y1。
    let y1 = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_a, &tool_y, "Y1", false),
    )
    .unwrap();

    // 未指定 launch，不应产生任何启动请求。
    assert_eq!(launcher.count(), 0);
    // 三个会话都拿到了真实（由工具返回）的原生标识。
    assert!(x1.session.native_session_id.is_some());
    assert!(x2.session.native_session_id.is_some());
    assert!(y1.session.native_session_id.is_some());

    // 5) 切换到工具 X：只能看到 X1、X2。
    let only_x = sessions::list(
        &conn,
        &SessionQuery {
            project_id: Some(project_a.clone()),
            tool_id: Some(tool_x.clone()),
            status: None,
        },
    )
    .unwrap();
    let x_names: HashSet<_> = only_x.iter().map(|s| s.display_name.clone()).collect();
    assert_eq!(x_names, HashSet::from(["X1".to_string(), "X2".to_string()]));
    assert!(only_x.iter().all(|s| s.tool_id == tool_x));

    // 6) 切换到工具 Y：只能看到 Y1。
    let only_y = sessions::list(
        &conn,
        &SessionQuery {
            project_id: Some(project_a.clone()),
            tool_id: Some(tool_y.clone()),
            status: None,
        },
    )
    .unwrap();
    assert_eq!(only_y.len(), 1);
    assert_eq!(only_y[0].display_name, "Y1");
    assert_eq!(only_y[0].tool_id, tool_y);

    // 7) 恢复 X1：应指向同一个原生会话，而不是新会话。
    let native_id_x1 = x1.session.native_session_id.clone().unwrap();
    backend.add_existing(&native_id_x1);
    let restored = native::restore(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        &x1.session.id,
    )
    .unwrap();
    assert!(restored.context_initialized);
    assert_eq!(launcher.count(), 1, "恢复只应产生一次启动");
    let spec = launcher.last();
    assert_eq!(
        spec.args,
        vec!["--session".to_string(), native_id_x1.clone()],
        "启动参数必须携带 X1 的原生标识"
    );
    assert_eq!(spec.working_dir, project_dir, "必须在项目 A 目录中恢复");
    // 恢复后本地记录仍指向同一原生会话。
    let reloaded = sessions::get(&conn, &x1.session.id).unwrap();
    assert_eq!(reloaded.native_session_id.as_deref(), Some(native_id_x1.as_str()));
}

/// 改名只改显示名（可选同步标题），不改变原生会话标识；重启后名称保留。
#[test]
fn rename_changes_display_name_only_and_persists_across_reopen() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db_path = workspace.path().join("data").join("vibeacross.db");

    let (session_id, native_id) = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project = import_project(&conn, &project_dir);
        let tool = add_tool(&conn, &detector, "opencode", &exe);

        let backend = FakeBackend::new();
        let launcher = RecordingLauncher::new();
        let guard = LaunchGuard::new();
        let created = native::create(
            &conn,
            &backend,
            &launcher,
            &guard,
            &detector,
            create_input(&project, &tool, "旧名字", false),
        )
        .unwrap();
        let native_id = created.session.native_session_id.clone().unwrap();

        // 仅改本地显示名：不同步原生标题，原生标识保持不变。
        let local = native::rename(&conn, &backend, &detector, &created.session.id, "仅本地改名", false).unwrap();
        assert!(!local.native_renamed);
        assert_eq!(local.session.display_name, "仅本地改名");
        assert_eq!(local.session.native_session_id.as_deref(), Some(native_id.as_str()));

        // 同步原生标题：原生标识同样不变。
        let synced = native::rename(&conn, &backend, &detector, &created.session.id, "同步标题", true).unwrap();
        assert!(synced.native_renamed);
        assert_eq!(synced.session.display_name, "同步标题");
        assert_eq!(synced.session.native_session_id.as_deref(), Some(native_id.as_str()));
        assert_eq!(backend.renames(), vec![(native_id.clone(), "同步标题".to_string())]);

        (created.session.id, native_id)
    };

    // 模拟应用重启：重新打开数据库，名称与原生标识都应保留。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();
    let reloaded = sessions::get(&conn, &session_id).unwrap();
    assert_eq!(reloaded.display_name, "同步标题");
    assert_eq!(reloaded.native_session_id.as_deref(), Some(native_id.as_str()));
}

/// 9) 项目 B 无法访问项目 A 的会话。
#[test]
fn project_b_cannot_access_project_a_sessions() {
    let workspace = tempfile::tempdir().unwrap();
    let dir_a = make_dir(workspace.path(), "a");
    let dir_b = make_dir(workspace.path(), "b");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();

    let project_a = import_project(&conn, &dir_a);
    let project_b = import_project(&conn, &dir_b);
    let tool = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    let a_session = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_a, &tool, "A 的会话", false),
    )
    .unwrap();

    // 项目 B 在同一工具下看不到任何会话。
    let b_sessions = sessions::list(
        &conn,
        &SessionQuery {
            project_id: Some(project_b.clone()),
            tool_id: Some(tool.clone()),
            status: None,
        },
    )
    .unwrap();
    assert!(b_sessions.is_empty(), "项目 B 不应看到项目 A 的会话");

    // 项目 B 也没有关联任何工具。
    assert!(project_tools::list_for_project(&conn, &project_b).unwrap().is_empty());

    // 项目 A 的会话仍在其名下，且归属解析正确。
    let stored = sessions::get(&conn, &a_session.session.id).unwrap();
    assert_eq!(stored.project_id, project_a);
}

/// 始终创建失败的启动器，用于验证启动 / 恢复失败的如实反馈。
struct FailingLauncher;

impl ProcessLauncher for FailingLauncher {
    fn launch(&self, _spec: &LaunchSpec) -> Result<u32, LaunchError> {
        Err(LaunchError::new("模拟启动失败"))
    }
}

/// 10) 重启应用后仍可查询、创建与恢复会话。
#[test]
fn sessions_remain_queryable_creatable_and_restorable_after_reopen() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db_path = workspace.path().join("data").join("vibeacross.db");
    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let (project_id, tool_id, first_session_id) = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project_id = import_project(&conn, &project_dir);
        let tool_id = add_tool(&conn, &detector, "opencode", &exe);
        let first = native::create(
            &conn,
            &backend,
            &launcher,
            &guard,
            &detector,
            create_input(&project_id, &tool_id, "重启前", false),
        )
        .unwrap();
        (project_id, tool_id, first.session.id)
    };

    // 重启：重新打开数据库，用同一批 id 继续查询 / 创建 / 恢复。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();

    let listed = sessions::list(
        &conn,
        &SessionQuery {
            project_id: Some(project_id.clone()),
            tool_id: Some(tool_id.clone()),
            status: None,
        },
    )
    .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, first_session_id);

    let second = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, "重启后", false),
    )
    .unwrap();

    let first_native = listed[0].native_session_id.clone().unwrap();
    backend.add_existing(&first_native);
    let restored = native::restore(&conn, &backend, &launcher, &guard, &detector, &first_session_id).unwrap();
    assert!(restored.context_initialized);
    assert_eq!(
        launcher.last().args,
        vec!["--session".to_string(), first_native]
    );
    assert!(second.session.native_session_id.is_some());
}

/// 11) 项目目录不存在：在创建前即如实拒绝，不产生任何本地记录。
#[test]
fn native_create_rejects_missing_project_directory() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    // 项目目录被外部删除。
    std::fs::remove_dir_all(&project_dir).unwrap();

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let error = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, "无效目录", false),
    )
    .unwrap_err();
    assert_eq!(error.code, "PROJECT_PATH_MISSING");
    // 工具未被调用、未产生启动请求、未写入任何会话记录。
    assert!(backend.created().is_empty());
    assert_eq!(launcher.count(), 0);
    assert!(sessions::list(&conn, &SessionQuery::default()).unwrap().is_empty());

    // 枚举与恢复同样如实报错。
    let list_error = native::list_native(&conn, &backend, &detector, &project_id, &tool_id).unwrap_err();
    assert_eq!(list_error.code, "PROJECT_PATH_MISSING");
}

/// 12) 工具未安装 / 未检测到：如实报告未就绪，绝不创建会话。
#[test]
fn uninstalled_tool_is_reported_not_ready() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    // 检测器看不到该可执行文件 -> 工具记录为「未检测到」。
    let detector_missing = StubDetector::new();
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector_missing, "opencode", &exe);

    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let error = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector_missing,
        create_input(&project_id, &tool_id, "未安装", false),
    )
    .unwrap_err();
    assert_eq!(error.code, "TOOL_NOT_READY");
    assert!(backend.created().is_empty());
    assert!(sessions::list(&conn, &SessionQuery::default()).unwrap().is_empty());
}

/// 13) 原生创建成功但本地关联保存失败：如实报错、尝试回滚、不留下第二条记录。
#[test]
fn duplicate_native_session_is_rolled_back_without_second_record() {
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

    // 第一次创建使用固定标识 "dup"，正常落库。
    backend.force_next_id("dup");
    let first = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, "第一条", false),
    )
    .unwrap();
    assert_eq!(first.session.native_session_id.as_deref(), Some("dup"));

    // 工具再次返回同一标识：本地关联保存失败，触发补偿回滚。
    backend.force_next_id("dup");
    let error = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, "第二条", false),
    )
    .unwrap_err();
    assert_eq!(error.code, "NATIVE_SESSION_PERSIST_FAILED");
    assert_eq!(backend.deleted(), vec!["dup".to_string()]);
    // 只保留第一条记录，未产生重复记录。
    assert_eq!(sessions::list(&conn, &SessionQuery::default()).unwrap().len(), 1);
}

/// 14) 原生会话被外部删除 / 标识无效：恢复如实报错，绝不静默新建。
#[test]
fn restore_reports_missing_native_session_without_creating() {
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
        create_input(&project_id, &tool_id, "将被删除", false),
    )
    .unwrap();

    // 不把该标识标记为「存在」：模拟工具端会话已被外部删除。
    let error = native::restore(&conn, &backend, &launcher, &guard, &detector, &created.session.id).unwrap_err();
    assert_eq!(error.code, "NATIVE_SESSION_MISSING");
    assert_eq!(launcher.count(), 0, "缺失时不得启动，绝不能静默新建");
}

/// 15) 启动 / 恢复失败时如实反馈；创建成功的会话仍被保留并可查询。
#[test]
fn launch_failures_are_reported_truthfully() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    let backend = FakeBackend::new();
    let guard = LaunchGuard::new();
    let failing = FailingLauncher;

    // 创建时启动失败：会话已真实创建并落库，launch_error 如实返回。
    let outcome = native::create(
        &conn,
        &backend,
        &failing,
        &guard,
        &detector,
        create_input(&project_id, &tool_id, "启动会失败", true),
    )
    .unwrap();
    assert!(outcome.launch.is_none());
    assert!(outcome.launch_error.is_some());
    assert!(sessions::get(&conn, &outcome.session.id).is_ok(), "会话应已保存");

    // 恢复时启动失败：直接返回错误，不谎报成功。
    let native_id = outcome.session.native_session_id.clone().unwrap();
    backend.add_existing(&native_id);
    let error = native::restore(&conn, &backend, &failing, &guard, &detector, &outcome.session.id).unwrap_err();
    assert!(error.message.contains("模拟启动失败"));
}

/// 16) 篡改的会话 / 项目 / 工具 id 一律被后端拒绝。
#[test]
fn tampered_ids_are_rejected() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = make_dir(workspace.path(), "proj");
    let exe = stub_exe(workspace.path(), "opencode.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let project_id = import_project(&conn, &project_dir);
    let tool_id = add_tool(&conn, &detector, "opencode", &exe);

    // 会话 id 不存在。
    assert_eq!(sessions::get(&conn, "ghost-session").unwrap_err().code, "SESSION_NOT_FOUND");

    // 项目 id 不存在。
    let missing_project = sessions::create(
        &conn,
        SessionInput {
            project_id: "ghost-project".to_string(),
            tool_id: tool_id.clone(),
            display_name: "会话".to_string(),
            native_session_id: None,
            working_directory: None,
        },
    )
    .unwrap_err();
    assert_eq!(missing_project.code, "PROJECT_NOT_FOUND");

    // 工具 id 不存在。
    let missing_tool = sessions::create(
        &conn,
        SessionInput {
            project_id: project_id.clone(),
            tool_id: "ghost-tool".to_string(),
            display_name: "会话".to_string(),
            native_session_id: None,
            working_directory: None,
        },
    )
    .unwrap_err();
    assert_eq!(missing_tool.code, "TOOL_NOT_FOUND");

    // 关联指向不存在的项目 / 工具。
    assert_eq!(
        project_tools::ensure(&conn, "ghost-project", &tool_id).unwrap_err().code,
        "PROJECT_NOT_FOUND"
    );
    assert_eq!(
        project_tools::ensure(&conn, &project_id, "ghost-tool").unwrap_err().code,
        "TOOL_NOT_FOUND"
    );

    // 原生操作同样拒绝篡改 id。
    let backend = FakeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();
    assert_eq!(
        native::restore(&conn, &backend, &launcher, &guard, &detector, "ghost-session")
            .unwrap_err()
            .code,
        "SESSION_NOT_FOUND"
    );
    assert_eq!(
        native::create(
            &conn,
            &backend,
            &launcher,
            &guard,
            &detector,
            create_input(&project_id, "ghost-tool", "会话", false),
        )
        .unwrap_err()
        .code,
        "TOOL_NOT_FOUND"
    );

    // 所有失败都不应留下任何会话或关联。
    assert!(sessions::list(&conn, &SessionQuery::default()).unwrap().is_empty());
    assert!(project_tools::list_for_project(&conn, &project_id).unwrap().is_empty());
}

/// 17) 删除本地记录只删 VibeAcross 自身记录，不影响工具中的原生会话。
#[test]
fn deleting_local_record_leaves_native_session_untouched() {
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
        create_input(&project_id, &tool_id, "待删除", false),
    )
    .unwrap();
    let native_id = created.session.native_session_id.clone().unwrap();

    sessions::delete(&conn, &created.session.id).unwrap();
    assert!(sessions::get(&conn, &created.session.id).is_err());
    // 未对原生会话发起任何删除（仅删本地记录）。
    assert!(backend.deleted().is_empty());
    // 原生会话仍在工具侧被记录为存在。
    backend.add_existing(&native_id);
    assert!(backend
        .get(
            &native::tool_context(&conn, &detector, &tool_id, &project_dir).unwrap(),
            &native_id,
        )
        .unwrap()
        .is_some());
}

