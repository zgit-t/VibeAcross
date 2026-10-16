//! Phase 5：项目与工具关联、受控启动的集成测试。
//!
//! 进程创建通过注入 `RecordingLauncher` 记录，不真正启动任何工具；
//! 另有一个使用真实 `cmd.exe` 的测试，验证工作目录与参数确实被正确传递。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::launch::{
    self, LaunchError, LaunchGuard, LaunchMode, LaunchSpec, ProcessLauncher,
};
use vibeacross_lib::projects;
use vibeacross_lib::tools::detect::{DetectError, Detector, RegistryInstall, VersionOutcome};
use vibeacross_lib::tools::model::{LaunchMethod, LaunchSupport, ToolConfigInput, ToolStatus, ToolType};
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
            next_pid: Mutex::new(4000),
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

/// 只判断「文件是否存在」的检测器，用于登记已检测到的工具。
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

fn custom_input(name: &str, tool_type: ToolType, path: &str) -> ToolConfigInput {
    ToolConfigInput {
        tool_id: None,
        name: Some(name.to_string()),
        tool_type: Some(tool_type),
        executable_path: Some(path.to_string()),
        command_name: None,
    }
}

/// 登记一个工具并返回其安装配置 id（内置工具按 tool_id 匹配，自定义工具按名称匹配）。
fn add_tool(
    conn: &rusqlite::Connection,
    detector: &dyn Detector,
    input: ToolConfigInput,
) -> String {
    let name = input.name.clone();
    let tool_id = input.tool_id.clone();
    tools::add_tool(conn, detector, input).unwrap();
    let state = tools::tool_state(conn, detector).unwrap();
    state
        .entries
        .iter()
        .find(|entry| {
            entry.source != "builtin"
                && (tool_id
                    .as_deref()
                    .map(|id| entry.tool_id == id)
                    .unwrap_or(false)
                    || name.as_deref().map(|value| entry.name == value).unwrap_or(false))
        })
        .map(|entry| entry.id.clone())
        .expect("未找到刚登记的工具")
}

/// 在真实磁盘上准备一个「可执行文件」桩（内容无关，仅需是文件）。
fn stub_exe(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, b"stub").unwrap();
    path.to_string_lossy().into_owned()
}

#[test]
fn project_can_store_and_change_default_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();

    let exe_a = stub_exe(workspace.path(), "ToolA.exe");
    let exe_b = stub_exe(workspace.path(), "ToolB.exe");
    let detector = StubDetector::new().with_file(&exe_a).with_file(&exe_b);

    let project = projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &exe_a));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &exe_b));

    // 未设置时为空。
    assert!(project.default_tool_id.is_none());

    let updated =
        launch::set_project_tool(&conn, &project.id, Some(&cursor_id), &detector).unwrap();
    assert_eq!(updated.default_tool_id.as_deref(), Some(cursor_id.as_str()));

    // 切换到另一个工具。
    let switched =
        launch::set_project_tool(&conn, &project.id, Some(&trae_id), &detector).unwrap();
    assert_eq!(switched.default_tool_id.as_deref(), Some(trae_id.as_str()));

    // 清除关联。
    let cleared = launch::set_project_tool(&conn, &project.id, None, &detector).unwrap();
    assert!(cleared.default_tool_id.is_none());
}

#[test]
fn different_projects_can_use_different_tools() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();

    let exe_a = stub_exe(workspace.path(), "ToolA.exe");
    let exe_b = stub_exe(workspace.path(), "ToolB.exe");
    let detector = StubDetector::new().with_file(&exe_a).with_file(&exe_b);

    let p1 = projects::create_project(&conn, "P1", workspace.path().to_str().unwrap()).unwrap();
    let p2 = projects::create_project(&conn, "P2", workspace.path().to_str().unwrap()).unwrap();
    let cursor_id = add_tool(&conn, &detector, tool_input("cursor", &exe_a));
    let trae_id = add_tool(&conn, &detector, tool_input("trae", &exe_b));

    launch::set_project_tool(&conn, &p1.id, Some(&cursor_id), &detector).unwrap();
    launch::set_project_tool(&conn, &p2.id, Some(&trae_id), &detector).unwrap();

    let listed = projects::list_projects(&conn, "name").unwrap();
    let by_id = |id: &str| {
        listed
            .iter()
            .find(|project| project.id == id)
            .unwrap()
            .default_tool_id
            .clone()
    };
    assert_eq!(by_id(&p1.id).as_deref(), Some(cursor_id.as_str()));
    assert_eq!(by_id(&p2.id).as_deref(), Some(trae_id.as_str()));
}

#[test]
fn project_tool_association_survives_reopen() {
    let workspace = tempfile::tempdir().unwrap();
    let exe = stub_exe(workspace.path(), "Tool.exe");
    let detector = StubDetector::new().with_file(&exe);
    let db_path = workspace.path().join("data").join("vibeacross.db");

    let (project_id, tool_id) = {
        let db = Database::open(db_path.clone()).unwrap();
        let conn = db.conn().unwrap();
        let project =
            projects::import_project(&conn, workspace.path().to_str().unwrap(), None).unwrap();
        let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
        launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();
        (project.id, tool_id)
    };

    // 重新打开数据库（模拟应用重启）。
    let db = Database::open(db_path).unwrap();
    let conn = db.conn().unwrap();
    let reloaded = projects::get_project(&conn, &project_id).unwrap();
    assert_eq!(reloaded.default_tool_id.as_deref(), Some(tool_id.as_str()));
}

#[test]
fn set_project_tool_rejects_unknown_or_unavailable_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();

    let project = projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();

    let unknown =
        launch::set_project_tool(&conn, &project.id, Some("no-such-id"), &detector).unwrap_err();
    assert_eq!(unknown.code, "TOOL_NOT_FOUND");

    // 已登记但未检测到（命令无法解析）→ 不可设为默认。
    let unresolved = ToolConfigInput {
        tool_id: None,
        name: Some("未解析 CLI".to_string()),
        tool_type: Some(ToolType::Cli),
        executable_path: None,
        command_name: Some("ghost-tool-xyz".to_string()),
    };
    let tool_id = add_tool(&conn, &detector, unresolved);
    let not_ready =
        launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap_err();
    assert_eq!(not_ready.code, "TOOL_NOT_READY");

    // 不存在的项目。
    let missing_project = launch::set_project_tool(&conn, "nope", None, &detector).unwrap_err();
    assert_eq!(missing_project.code, "PROJECT_NOT_FOUND");
}

#[test]
fn launch_requires_tool_selection() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();

    let error = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();
    assert_eq!(error.code, "TOOL_CONFIG_REQUIRED");
    assert_eq!(launcher.count(), 0);
}

#[test]
fn desktop_tool_launches_with_folder_argument() {
    // 目录含空格与非 ASCII，验证路径处理。
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("我的 项目");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    let result = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap();
    assert_eq!(result.method, LaunchMethod::FolderArgument);
    assert_eq!(result.tool_name, "Cursor");

    let spec = launcher.last();
    assert_eq!(spec.mode, LaunchMode::Detached);
    assert_eq!(spec.args, vec![project.path.clone()]);
    assert_eq!(spec.working_dir, PathBuf::from(&project.path));
    assert_eq!(spec.executable.file_name().unwrap(), "Cursor.exe");
}

#[test]
fn cli_tool_launches_in_project_working_directory_without_extra_args() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("cli 项目");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "claude.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("claude-code", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    let result = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap();
    assert_eq!(result.method, LaunchMethod::WorkingDirectory);

    let spec = launcher.last();
    assert_eq!(spec.mode, LaunchMode::Console);
    assert!(spec.args.is_empty(), "命令行工具不应被注入额外参数");
    assert_eq!(spec.working_dir, PathBuf::from(&project.path));
}

#[test]
fn custom_cli_tool_is_supported_but_custom_desktop_is_not() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let cli_exe = stub_exe(workspace.path(), "mytool.exe");
    let gui_exe = stub_exe(workspace.path(), "mygui.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new()
        .with_file(&cli_exe)
        .with_file(&gui_exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();

    // 自定义 CLI：以工作目录方式启动。
    let cli_id = add_tool(
        &conn,
        &detector,
        custom_input("自定义 CLI", ToolType::Cli, &cli_exe),
    );
    launch::set_project_tool(&conn, &project.id, Some(&cli_id), &detector).unwrap();
    let result = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap();
    assert_eq!(result.method, LaunchMethod::WorkingDirectory);

    // 自定义桌面应用：启动参数未知，保守拒绝。
    let gui_id = add_tool(
        &conn,
        &detector,
        custom_input("自定义桌面", ToolType::Desktop, &gui_exe),
    );
    let error = launch::launch(&conn, &launcher, &guard, &project.id, Some(&gui_id), &detector)
        .unwrap_err();
    assert_eq!(error.code, "LAUNCH_UNSUPPORTED");
}

#[test]
fn workbuddy_launch_is_reported_as_unsupported() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "WorkBuddy.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("workbuddy", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    let error = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();
    assert_eq!(error.code, "LAUNCH_UNSUPPORTED");
    assert_eq!(launcher.count(), 0);
}

#[test]
fn script_based_cli_requires_configuration() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let script = stub_exe(workspace.path(), "opencode.cmd");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&script);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("opencode", &script));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    let error = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();
    assert_eq!(error.code, "LAUNCH_NEEDS_CONFIGURATION");
    assert_eq!(launcher.count(), 0);
}

#[test]
fn launch_rejects_missing_or_invalid_paths() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let exe = stub_exe(workspace.path(), "Tool.exe");
    let detector = StubDetector::new().with_file(&exe);

    // 项目目录在登记后被删除。
    let gone_dir = workspace.path().join("gone");
    std::fs::create_dir(&gone_dir).unwrap();
    let project = projects::import_project(&conn, gone_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    std::fs::remove_dir(&gone_dir).unwrap();
    let missing_project =
        launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();
    assert_eq!(missing_project.code, "PROJECT_PATH_MISSING");

    // 项目路径指向文件而非目录。
    let file_path = workspace.path().join("afile");
    std::fs::write(&file_path, b"x").unwrap();
    conn.execute(
        "UPDATE projects SET path = ?1 WHERE id = ?2",
        rusqlite::params![file_path.to_string_lossy(), project.id],
    )
    .unwrap();
    let not_dir = launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();
    assert_eq!(not_dir.code, "PROJECT_PATH_NOT_DIR");

    // 工具可执行文件在登记后被删除。
    let ok_dir = workspace.path().join("ok");
    std::fs::create_dir(&ok_dir).unwrap();
    let project2 = projects::import_project(&conn, ok_dir.to_str().unwrap(), None).unwrap();
    std::fs::remove_file(&exe).unwrap();
    let path_missing =
        launch::launch(&conn, &launcher, &guard, &project2.id, Some(&tool_id), &detector)
            .unwrap_err();
    assert_eq!(path_missing.code, "PATH_NOT_FOUND");

    // 不存在的项目。
    let unknown =
        launch::launch(&conn, &launcher, &guard, "missing-project", None, &detector).unwrap_err();
    assert_eq!(unknown.code, "PROJECT_NOT_FOUND");
}

#[test]
fn repeated_launch_is_debounced() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap();
    let duplicate =
        launch::launch(&conn, &launcher, &guard, &project.id, None, &detector).unwrap_err();

    assert_eq!(duplicate.code, "LAUNCH_DUPLICATE");
    assert_eq!(launcher.count(), 1, "重复点击不应产生第二个进程");
}

#[test]
fn explicit_launch_persists_tool_as_project_default() {
    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = StubDetector::new().with_file(&exe);
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));

    // 未设置默认，直接显式指定工具启动。
    launch::launch(&conn, &launcher, &guard, &project.id, Some(&tool_id), &detector).unwrap();

    let stored = projects::get_project(&conn, &project.id).unwrap();
    assert_eq!(stored.default_tool_id.as_deref(), Some(tool_id.as_str()));
}

#[test]
fn removing_tool_clears_project_references() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);

    let project = projects::create_project(&conn, "P", workspace.path().to_str().unwrap()).unwrap();
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    launch::set_project_tool(&conn, &project.id, Some(&tool_id), &detector).unwrap();

    tools::remove_tool(&conn, &tool_id).unwrap();
    launch::clear_tool_references(&conn, &tool_id).unwrap();

    let reloaded = projects::get_project(&conn, &project.id).unwrap();
    assert!(reloaded.default_tool_id.is_none());
}

#[test]
fn launch_state_reports_support_per_status() {
    let workspace = tempfile::tempdir().unwrap();
    let db = memory_db();
    let conn = db.conn().unwrap();

    // 未检测到的内置工具：不可用。
    let state = tools::tool_state(&conn, &StubDetector::new()).unwrap();
    let trae = state.entries.iter().find(|entry| entry.tool_id == "trae").unwrap();
    assert_eq!(trae.status, ToolStatus::NotDetected);
    assert_eq!(trae.launch.support, LaunchSupport::Unavailable);

    // 已检测到的桌面工具：支持以目录参数启动。
    let exe = stub_exe(workspace.path(), "Cursor.exe");
    let detector = StubDetector::new().with_file(&exe);
    let tool_id = add_tool(&conn, &detector, tool_input("cursor", &exe));
    let state = tools::tool_state(&conn, &detector).unwrap();
    let cursor = state.entries.iter().find(|entry| entry.id == tool_id).unwrap();
    assert_eq!(cursor.launch.support, LaunchSupport::Supported);
    assert_eq!(cursor.launch.method, Some(LaunchMethod::FolderArgument));
}

#[cfg(windows)]
#[test]
fn system_launcher_honors_working_dir_and_arguments() {
    use vibeacross_lib::launch::SystemLauncher;

    let workspace = tempfile::tempdir().unwrap();
    // 使用 ASCII 路径，避免不同控制台代码页影响断言。
    let project_dir = workspace.path().join("cwd-check");
    std::fs::create_dir(&project_dir).unwrap();
    let out = project_dir.join("out.txt");

    let comspec =
        std::env::var("ComSpec").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".to_string());

    let spec = LaunchSpec {
        executable: PathBuf::from(&comspec),
        args: vec![
            "/c".to_string(),
            format!("cd > {} & echo ARG_OK >> {}", out.display(), out.display()),
        ],
        working_dir: project_dir.clone(),
        mode: LaunchMode::Detached,
    };

    let pid = SystemLauncher::new().launch(&spec).expect("应能创建真实进程");
    assert!(pid > 0);

    // 等待被启动进程写完记录文件。
    let mut content = String::new();
    for _ in 0..40 {
        if let Ok(text) = std::fs::read_to_string(&out) {
            if text.contains("ARG_OK") {
                content = text;
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    assert!(content.contains("ARG_OK"), "参数应被真实传递：{content:?}");
    let recorded_cwd = content.lines().next().unwrap_or("").trim().to_string();
    let expected_raw = std::fs::canonicalize(&project_dir)
        .unwrap_or(project_dir.clone())
        .to_string_lossy()
        .to_string();
    // `canonicalize` 会带 `\\?\` 扩展前缀，而 `cmd` 的 `cd` 不会。
    let expected = expected_raw
        .strip_prefix(r"\\?\")
        .map(str::to_string)
        .unwrap_or(expected_raw);
    let normalize = |value: &str| value.trim_end_matches(['\\', '/']).to_ascii_lowercase();
    assert_eq!(
        normalize(&recorded_cwd),
        normalize(&expected),
        "工作目录应被正确传递"
    );
}
