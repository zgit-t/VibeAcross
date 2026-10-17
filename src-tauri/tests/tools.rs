use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::tools::detect::{
    resolve_in_paths, run_version_command, DetectError, Detector, RegistryInstall, SystemDetector,
    VersionOutcome,
};
use vibeacross_lib::tools::model::{
    LaunchMethod, LaunchSupport, ToolConfigInput, ToolEntry, ToolState, ToolStatus, ToolType,
};
use vibeacross_lib::tools::service;

/// 可注入的假检测器：完全由测试控制，不触碰真实系统。
#[derive(Default)]
struct FakeDetector {
    files: Mutex<HashSet<String>>,
    commands: Mutex<HashMap<String, String>>,
    versions: Mutex<HashMap<String, String>>,
    denied: Mutex<HashSet<String>>,
    registry: Mutex<Vec<RegistryInstall>>,
    app_paths: Mutex<HashMap<String, String>>,
    /// `.lnk` 路径 → 目标可执行文件路径。
    shortcuts: Mutex<Vec<(String, String)>>,
    /// 允许回退到真实文件系统（用于「含空格 / 非 ASCII 路径」测试）。
    real_fs: bool,
}

impl FakeDetector {
    fn new() -> Self {
        Self::default()
    }

    fn with_real_fs() -> Self {
        Self {
            real_fs: true,
            ..Self::default()
        }
    }

    fn with_file(mut self, path: &str) -> Self {
        self.files.get_mut().unwrap().insert(normalize(path));
        self
    }

    fn with_command(mut self, name: &str, path: &str) -> Self {
        self.commands
            .get_mut()
            .unwrap()
            .insert(name.to_string(), path.to_string());
        self
    }

    fn with_version(mut self, path: &str, version: &str) -> Self {
        self.versions
            .get_mut()
            .unwrap()
            .insert(normalize(path), version.to_string());
        self
    }

    fn with_app_path(mut self, exe_name: &str, path: &str) -> Self {
        self.app_paths
            .get_mut()
            .unwrap()
            .insert(exe_name.to_string(), path.to_string());
        self
    }

    fn with_shortcut(mut self, lnk: &str, target: &str) -> Self {
        self.shortcuts
            .get_mut()
            .unwrap()
            .push((lnk.to_string(), target.to_string()));
        self
    }

    fn with_registry(mut self, install: RegistryInstall) -> Self {
        self.registry.get_mut().unwrap().push(install);
        self
    }

    fn add_file(&self, path: &str) {
        self.files.lock().unwrap().insert(normalize(path));
    }

    fn remove_file(&self, path: &str) {
        self.files.lock().unwrap().remove(&normalize(path));
    }

    fn deny(&self, path: &str) {
        self.denied.lock().unwrap().insert(normalize(path));
    }
}

fn normalize(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_ascii_lowercase()
}

impl Detector for FakeDetector {
    fn file_exists(&self, path: &Path) -> Result<bool, DetectError> {
        let key = normalize(&path.to_string_lossy());
        if self.denied.lock().unwrap().contains(&key) {
            return Err(DetectError::new("访问被拒绝"));
        }
        if self.files.lock().unwrap().contains(&key) {
            return Ok(true);
        }
        if self.real_fs {
            return Ok(std::fs::metadata(path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false));
        }
        Ok(false)
    }

    fn resolve_command(&self, name: &str) -> Option<PathBuf> {
        self.commands.lock().unwrap().get(name).map(PathBuf::from)
    }

    fn registry_installs(&self, _keywords: &[&str]) -> Vec<RegistryInstall> {
        self.registry.lock().unwrap().clone()
    }

    fn app_path(&self, exe_name: &str) -> Option<PathBuf> {
        self.app_paths
            .lock()
            .unwrap()
            .get(exe_name)
            .map(PathBuf::from)
    }

    fn shortcut_files(&self) -> Vec<PathBuf> {
        self.shortcuts
            .lock()
            .unwrap()
            .iter()
            .map(|(lnk, _)| PathBuf::from(lnk))
            .collect()
    }

    fn shortcut_target(&self, lnk: &Path) -> Option<PathBuf> {
        let key = normalize(&lnk.to_string_lossy());
        self.shortcuts
            .lock()
            .unwrap()
            .iter()
            .find(|(candidate, _)| normalize(candidate) == key)
            .map(|(_, target)| PathBuf::from(target))
    }

    fn query_version(&self, executable: &Path, _args: &[&str]) -> VersionOutcome {
        match self
            .versions
            .lock()
            .unwrap()
            .get(&normalize(&executable.to_string_lossy()))
        {
            Some(value) => VersionOutcome::Value(value.clone()),
            None => VersionOutcome::Failed("没有版本信息".to_string()),
        }
    }
}

fn memory_db() -> Database {
    Database::open_in_memory().expect("创建内存数据库失败")
}

fn find<'a>(state: &'a ToolState, tool_id: &str) -> &'a ToolEntry {
    state
        .entries
        .iter()
        .find(|entry| entry.tool_id == tool_id && entry.source != "builtin")
        .or_else(|| state.entries.iter().find(|entry| entry.tool_id == tool_id))
        .unwrap_or_else(|| panic!("未找到工具 {tool_id}"))
}

fn input(tool_id: &str, path: Option<&str>, command: Option<&str>) -> ToolConfigInput {
    ToolConfigInput {
        tool_id: Some(tool_id.to_string()),
        name: None,
        tool_type: None,
        executable_path: path.map(str::to_string),
        command_name: command.map(str::to_string),
    }
}

#[test]
fn detect_reports_detected_for_resolved_command() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new()
        .with_command("claude", r"C:\tools\claude.exe")
        .with_file(r"C:\tools\claude.exe")
        .with_version(r"C:\tools\claude.exe", "1.2.3");

    let state = service::detect_tools(&conn, &detector, None).unwrap();
    let entry = find(&state, "claude-code");

    assert_eq!(entry.status, ToolStatus::Detected);
    assert_eq!(entry.version.as_deref(), Some("1.2.3"));
    assert!(entry.detection_method.as_deref().unwrap().contains("claude"));
    assert!(state.last_detection_at.is_some());
}

#[test]
fn reliable_unconfigured_tool_is_not_installed_after_full_detection() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let state = service::detect_tools(&conn, &detector, None).unwrap();
    assert_eq!(find(&state, "trae").status, ToolStatus::NotInstalled);
    assert_eq!(find(&state, "cursor").status, ToolStatus::NotInstalled);
}

#[test]
fn trae_and_trae_solo_are_detected_independently() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let solo_exe = r"D:\TRAE SOLO CN\TRAE SOLO CN.exe";
    let detector = FakeDetector::new()
        .with_file(solo_exe)
        .with_app_path("TRAE SOLO CN.exe", solo_exe);

    let state = service::detect_tools(&conn, &detector, None).unwrap();
    let solo = find(&state, "trae-solo");
    assert_eq!(solo.name, "TRAE SOLO");
    assert_eq!(solo.status, ToolStatus::Detected);
    assert_eq!(solo.executable_path.as_deref(), Some(solo_exe));

    // TRAE SOLO 不得被 Trae 识别为自己的安装。
    let trae = find(&state, "trae");
    assert_ne!(trae.status, ToolStatus::Detected);
    assert_ne!(trae.executable_path.as_deref(), Some(solo_exe));

    // 两者的 App Paths 可执行文件名必须完全不相交。
    let trae_paths: HashSet<_> = vibeacross_lib::tools::catalog::find("trae")
        .unwrap()
        .app_paths
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let solo_paths: HashSet<_> = vibeacross_lib::tools::catalog::find("trae-solo")
        .unwrap()
        .app_paths
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    assert!(trae_paths.is_disjoint(&solo_paths));
}

#[test]
fn trae_registry_ignores_trae_solo_uninstall_entry() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let solo_exe = r"D:\TRAE SOLO CN\TRAE SOLO CN.exe";
    let detector = FakeDetector::new()
        .with_file(solo_exe)
        .with_registry(RegistryInstall {
            display_name: "TRAE SOLO CN".to_string(),
            install_location: None,
            display_icon: Some(solo_exe.to_string()),
        });

    let state = service::detect_tools(&conn, &detector, None).unwrap();
    // 该卸载项属于 TRAE SOLO，Trae 必须忽略它，绝不把 SOLO 当作 Trae。
    let trae = find(&state, "trae");
    assert_ne!(trae.status, ToolStatus::Detected);
    assert_ne!(trae.executable_path.as_deref(), Some(solo_exe));
}

#[test]
fn unreliable_tool_is_never_marked_not_installed() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let state = service::detect_tools(&conn, &detector, None).unwrap();
    let workbuddy = find(&state, "workbuddy");

    assert_eq!(workbuddy.status, ToolStatus::NotDetected);
    assert!(!workbuddy.auto_detect_reliable);
    assert!(state.last_detection_at.is_some());
}

#[test]
fn single_tool_detection_does_not_claim_not_installed() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let state = service::detect_tools(&conn, &detector, Some("opencode")).unwrap();

    assert_eq!(find(&state, "trae").status, ToolStatus::NotDetected);
    assert!(state.last_detection_at.is_none());
}

#[test]
fn manual_path_is_revalidated_on_detection() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    assert_eq!(find(&state, "cursor").status, ToolStatus::PathMissing);

    detector.add_file(r"C:\apps\Cursor\Cursor.exe");
    let state = service::detect_tools(&conn, &detector, Some("cursor")).unwrap();
    assert_eq!(find(&state, "cursor").status, ToolStatus::Detected);
}

#[test]
fn revalidate_tool_rechecks_only_that_config_without_creating_duplicates() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();

    let before = service::tool_state(&conn, &detector).unwrap();
    let entry = find(&before, "cursor");
    assert_eq!(entry.status, ToolStatus::PathMissing);
    let id = entry.id.clone();
    let count_before = before
        .entries
        .iter()
        .filter(|candidate| candidate.tool_id == "cursor")
        .count();

    // 路径恢复后仅重新校验这一条配置：状态变为已检测，且不新增自动检测条目。
    detector.add_file(r"C:\apps\Cursor\Cursor.exe");
    let after = service::revalidate_tool(&conn, &detector, &id).unwrap();
    assert_eq!(
        after
            .entries
            .iter()
            .filter(|candidate| candidate.tool_id == "cursor")
            .count(),
        count_before
    );
    assert_eq!(find(&after, "cursor").status, ToolStatus::Detected);
    assert_eq!(find(&after, "cursor").source, "manual");
}

#[test]
fn revalidate_tool_rejects_unknown_id() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let error = service::revalidate_tool(&conn, &detector, "missing").unwrap_err();
    assert_eq!(error.code, "TOOL_NOT_FOUND");
}

#[test]
fn duplicate_manual_configuration_is_rejected() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new().with_file(r"C:\apps\Cursor\Cursor.exe");

    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();
    let error = service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"c:/apps/cursor/Cursor.EXE"), None),
    )
    .unwrap_err();

    assert_eq!(error.code, "TOOL_DUPLICATE");
}

#[test]
fn default_tool_must_be_detected_and_is_singular() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new()
        .with_file(r"C:\apps\Trae\Trae.exe")
        .with_file(r"C:\apps\Cursor\Cursor.exe");

    service::add_tool(
        &conn,
        &detector,
        input("trae", Some(r"C:\apps\Trae\Trae.exe"), None),
    )
    .unwrap();
    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();

    let state = service::tool_state(&conn, &detector).unwrap();
    let trae_id = find(&state, "trae").id.clone();
    let cursor_id = find(&state, "cursor").id.clone();

    service::set_default_tool(&conn, Some(&trae_id)).unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    assert!(find(&state, "trae").is_default);

    service::set_default_tool(&conn, Some(&cursor_id)).unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    assert!(find(&state, "cursor").is_default);
    assert!(!find(&state, "trae").is_default);
}

#[test]
fn default_tool_is_cleared_when_path_disappears() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new().with_file(r"C:\apps\Trae\Trae.exe");

    service::add_tool(
        &conn,
        &detector,
        input("trae", Some(r"C:\apps\Trae\Trae.exe"), None),
    )
    .unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let trae_id = find(&state, "trae").id.clone();
    service::set_default_tool(&conn, Some(&trae_id)).unwrap();

    detector.remove_file(r"C:\apps\Trae\Trae.exe");
    let state = service::detect_tools(&conn, &detector, Some("trae")).unwrap();
    let trae = find(&state, "trae");

    assert_eq!(trae.status, ToolStatus::PathMissing);
    assert!(!trae.is_default);
}

#[test]
fn set_default_rejects_unavailable_tool() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let cursor_id = find(&state, "cursor").id.clone();

    let error = service::set_default_tool(&conn, Some(&cursor_id)).unwrap_err();
    assert_eq!(error.code, "TOOL_NOT_READY");
}

#[test]
fn permission_error_is_reported_as_detection_failed() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let candidates =
        vibeacross_lib::tools::catalog::find("trae").expect("未找到 trae 定义").candidate_paths;
    for candidate in candidates {
        if let Some(expanded) = vibeacross_lib::tools::catalog::expand_candidate(candidate) {
            detector.deny(&expanded);
        }
    }

    let state = service::detect_tools(&conn, &detector, Some("trae")).unwrap();
    let trae = find(&state, "trae");

    assert_eq!(trae.status, ToolStatus::DetectionFailed);
    assert!(trae.last_error.is_some());
}

#[test]
fn script_installation_is_launchable_via_command_interpreter() {
    // Windows 上 npm 安装的 CLI 工具通常只有 `.cmd` 入口：应判定为可启动，
    // 并沿用命令行工作目录方式（实际经命令解释器启动）。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let path = r"C:\Users\me\AppData\Roaming\npm\opencode.cmd";
    let detector = FakeDetector::new().with_file(path);

    service::add_tool(&conn, &detector, input("opencode", Some(path), None)).unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let entry = find(&state, "opencode");

    assert_eq!(entry.status, ToolStatus::Detected);
    assert_eq!(entry.launch.support, LaunchSupport::Supported);
    assert_eq!(entry.launch.method, Some(LaunchMethod::WorkingDirectory));
}

#[test]
fn unsafe_script_path_requires_configuration() {
    // 路径含无法安全转义的字符时，不得谎报可启动，转为可操作的补充配置提示。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let path = r"C:\npm\bad%tool.cmd";
    let detector = FakeDetector::new().with_file(path);

    service::add_tool(&conn, &detector, input("opencode", Some(path), None)).unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let entry = find(&state, "opencode");

    assert_eq!(entry.status, ToolStatus::Detected);
    assert_eq!(entry.launch.support, LaunchSupport::NeedsConfiguration);
    assert!(entry.launch.method.is_none());
    assert!(
        entry.launch.reason.contains('%'),
        "原因应说明无法安全转义的字符：{}",
        entry.launch.reason
    );
}

#[test]
fn manual_configuration_is_not_overwritten_by_detection() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let manual = r"D:\Portable\Cursor\Cursor.exe";
    let auto = r"C:\apps\Cursor\Cursor.exe";
    let detector = FakeDetector::new()
        .with_file(manual)
        .with_file(auto)
        .with_app_path("Cursor.exe", auto);

    service::add_tool(&conn, &detector, input("cursor", Some(manual), None)).unwrap();

    // 全量检测会经 App Paths 找到另一个安装位置，但不得覆盖用户手动配置的路径。
    let after = service::detect_tools(&conn, &detector, Some("cursor")).unwrap();

    let manual_entry = after
        .entries
        .iter()
        .find(|entry| entry.source == "manual")
        .expect("手动配置条目应保留");
    assert_eq!(manual_entry.executable_path.as_deref(), Some(manual));
    assert_eq!(manual_entry.status, ToolStatus::Detected);

    // 自动检测结果作为独立条目并存，而不是覆盖手动条目。
    let auto_entries: Vec<_> = after
        .entries
        .iter()
        .filter(|entry| entry.tool_id == "cursor" && entry.source == "auto")
        .collect();
    assert_eq!(auto_entries.len(), 1);
    assert_eq!(auto_entries[0].executable_path.as_deref(), Some(auto));
}

#[test]
fn custom_tool_with_unresolved_command_is_unverified() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let custom = ToolConfigInput {
        tool_id: None,
        name: Some("我的工具".to_string()),
        tool_type: Some(ToolType::Cli),
        executable_path: None,
        command_name: Some("mytool".to_string()),
    };
    service::add_tool(&conn, &detector, custom).unwrap();

    let state = service::tool_state(&conn, &detector).unwrap();
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.name == "我的工具")
        .expect("未找到自定义工具");
    assert_eq!(entry.status, ToolStatus::Unverified);
    assert!(entry.is_custom);
}

#[test]
fn unknown_tool_id_and_empty_config_are_rejected() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new();

    let unknown = service::add_tool(
        &conn,
        &detector,
        input("not-a-tool", Some(r"C:\x.exe"), None),
    )
    .unwrap_err();
    assert_eq!(unknown.code, "TOOL_UNKNOWN");

    let empty = service::add_tool(
        &conn,
        &detector,
        ToolConfigInput {
            tool_id: Some("cursor".to_string()),
            name: None,
            tool_type: None,
            executable_path: None,
            command_name: None,
        },
    )
    .unwrap_err();
    assert_eq!(empty.code, "TOOL_CONFIG_REQUIRED");
}

#[test]
fn manual_path_with_spaces_and_non_ascii_is_canonicalized() {
    let workspace = tempfile::tempdir().unwrap();
    let dir = workspace.path().join("工具 目录");
    std::fs::create_dir_all(&dir).unwrap();
    let exe = dir.join("我的 应用.exe");
    std::fs::write(&exe, b"stub").unwrap();

    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::with_real_fs();

    let custom = ToolConfigInput {
        tool_id: None,
        name: Some("含空格工具".to_string()),
        tool_type: Some(ToolType::Desktop),
        executable_path: Some(exe.to_string_lossy().into_owned()),
        command_name: None,
    };
    service::add_tool(&conn, &detector, custom).unwrap();

    let state = service::tool_state(&conn, &detector).unwrap();
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.name == "含空格工具")
        .expect("未找到自定义工具");

    assert_eq!(entry.status, ToolStatus::Detected);
    let stored = entry.executable_path.as_deref().unwrap();
    assert!(Path::new(stored).is_file(), "存储路径应可在磁盘上解析：{stored}");
    assert!(stored.contains("我的 应用.exe"));
}

#[test]
fn removed_tool_disappears_from_state() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new().with_file(r"C:\apps\Cursor\Cursor.exe");

    service::add_tool(
        &conn,
        &detector,
        input("cursor", Some(r"C:\apps\Cursor\Cursor.exe"), None),
    )
    .unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let cursor_id = find(&state, "cursor").id.clone();

    service::remove_tool(&conn, &cursor_id).unwrap();
    let state = service::tool_state(&conn, &detector).unwrap();
    let cursor = find(&state, "cursor");

    assert_eq!(cursor.source, "builtin");
    assert_eq!(cursor.status, ToolStatus::NotDetected);
}

#[test]
fn app_paths_locates_desktop_tool_outside_candidate_paths() {
    // 安装目录由用户自选（不在候选路径中），仅通过 App Paths 注册表登记。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let custom = r"D:\Portable Apps\Trae\Trae.exe";
    let detector = FakeDetector::new()
        .with_app_path("Trae.exe", custom)
        .with_file(custom);

    let state = service::detect_tools(&conn, &detector, Some("trae")).unwrap();
    let trae = find(&state, "trae");

    assert_eq!(trae.status, ToolStatus::Detected);
    assert_eq!(trae.executable_path.as_deref(), Some(custom));
    assert!(
        trae.detection_method.as_deref().unwrap().contains("App Paths"),
        "检测方式应记录来源：{:?}",
        trae.detection_method
    );
}

#[test]
fn workbuddy_is_detected_via_app_paths_without_claiming_not_installed() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = r"C:\Users\me\AppData\Local\Programs\Tencent WorkBuddy\Tencent WorkBuddy.exe";
    let detector = FakeDetector::new()
        .with_app_path("Tencent WorkBuddy.exe", exe)
        .with_file(exe);

    let state = service::detect_tools(&conn, &detector, Some("workbuddy")).unwrap();
    let workbuddy = find(&state, "workbuddy");

    assert_eq!(workbuddy.status, ToolStatus::Detected);
    assert!(workbuddy.executable_path.is_some());
}

#[test]
fn shortcut_locates_desktop_tool_installed_in_custom_directory() {
    // 安装到自选的 `D:\` 目录，且无 App Paths / 卸载登记，仅桌面快捷方式可定位。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = r"D:\Trae CN\Trae CN.exe";
    let detector = FakeDetector::new()
        .with_shortcut(r"C:\Users\me\Desktop\Trae CN.lnk", exe)
        .with_file(exe);

    let state = service::detect_tools(&conn, &detector, Some("trae")).unwrap();
    let trae = find(&state, "trae");

    assert_eq!(trae.status, ToolStatus::Detected);
    assert_eq!(trae.executable_path.as_deref(), Some(exe));
    assert!(
        trae.detection_method.as_deref().unwrap().contains("快捷方式"),
        "检测方式应记录来源：{:?}",
        trae.detection_method
    );
}

#[test]
fn workbuddy_shortcut_locates_custom_install() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = r"D:\WorkBuddy\WorkBuddy.exe";
    let detector = FakeDetector::new()
        .with_shortcut(r"C:\Users\me\Desktop\WorkBuddy.lnk", exe)
        .with_file(exe);

    let state = service::detect_tools(&conn, &detector, Some("workbuddy")).unwrap();
    let workbuddy = find(&state, "workbuddy");

    assert_eq!(workbuddy.status, ToolStatus::Detected);
    assert_eq!(workbuddy.executable_path.as_deref(), Some(exe));
}

#[test]
fn shortcut_with_unrelated_target_is_ignored() {
    // 快捷方式目标文件名与工具的 app_paths 不符时不得据此识别。
    let db = memory_db();
    let conn = db.conn().unwrap();
    let target = r"D:\Other\OtherApp.exe";
    let detector = FakeDetector::new()
        .with_shortcut(r"C:\Users\me\Desktop\Trae.lnk", target)
        .with_file(target);

    let state = service::detect_tools(&conn, &detector, Some("trae")).unwrap();
    assert_eq!(find(&state, "trae").status, ToolStatus::NotDetected);
}

#[test]
fn auto_detected_app_paths_are_stored_as_auto_source() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let exe = r"D:\IDE\Cursor\Cursor.exe";
    let detector = FakeDetector::new()
        .with_app_path("Cursor.exe", exe)
        .with_file(exe);

    let state = service::detect_tools(&conn, &detector, Some("cursor")).unwrap();
    let cursor = find(&state, "cursor");
    assert_eq!(cursor.status, ToolStatus::Detected);
    assert_eq!(cursor.source, "auto");
}

#[test]
fn desktop_catalog_covers_arch_virtualized_paths_and_app_paths() {
    for tool_id in ["trae", "trae-solo", "workbuddy", "cursor"] {
        let definition = vibeacross_lib::tools::catalog::find(tool_id).unwrap();
        assert!(
            !definition.app_paths.is_empty(),
            "{tool_id} 应登记用于 App Paths 查找的可执行文件名"
        );
        let has_arch_candidate = definition.candidate_paths.iter().any(|candidate| {
            let upper = candidate.to_ascii_uppercase();
            upper.contains("PROGRAMFILES(X86)") || upper.contains("PROGRAMW6432")
        });
        assert!(
            has_arch_candidate,
            "{tool_id} 应包含 %ProgramFiles(x86)% / %ProgramW6432% 候选路径"
        );
    }
}


#[test]
fn resolve_in_paths_prefers_executable_over_script() {
    let workspace = tempfile::tempdir().unwrap();
    let dir = workspace.path();
    std::fs::write(dir.join("tool.exe"), b"stub").unwrap();
    std::fs::write(dir.join("tool.cmd"), b"stub").unwrap();

    let path_env = std::env::join_paths([dir]).unwrap();
    let resolved = resolve_in_paths("tool", &path_env, ".COM;.EXE;.BAT;.CMD").unwrap();

    assert_eq!(
        resolved
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_ascii_lowercase(),
        "tool.exe"
    );
}

#[cfg(windows)]
#[test]
fn version_query_skips_script_files() {
    let workspace = tempfile::tempdir().unwrap();
    let script = workspace.path().join("tool.cmd");
    std::fs::write(&script, b"@echo off\r\n").unwrap();

    let outcome = SystemDetector::new().query_version(&script, &["--version"]);

    // 脚本文件必须跳过，绝不经由 shell 执行。
    assert_eq!(outcome, VersionOutcome::Unsupported);
}

#[cfg(windows)]
#[test]
fn version_query_reads_stdout_from_binary() {
    let comspec = std::env::var("ComSpec").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into());
    let outcome = run_version_command(
        Path::new(&comspec),
        &["/c", "echo", "v9.9.9"],
        std::time::Duration::from_secs(4),
    );

    assert_eq!(outcome, VersionOutcome::Value("v9.9.9".to_string()));
}

#[cfg(windows)]
#[test]
fn version_query_times_out_for_slow_command() {
    let ping = Path::new(r"C:\Windows\System32\PING.EXE");
    if !ping.is_file() {
        return;
    }
    let outcome = run_version_command(
        ping,
        &["-n", "10", "127.0.0.1"],
        std::time::Duration::from_millis(300),
    );

    assert_eq!(outcome, VersionOutcome::Timeout);
}

#[test]
fn update_tool_changes_path_without_creating_duplicates() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new()
        .with_file(r"C:\tools\opencode-a.exe")
        .with_file(r"C:\tools\opencode-b.exe");

    service::add_tool(
        &conn,
        &detector,
        input("opencode", Some(r"C:\tools\opencode-a.exe"), None),
    )
    .unwrap();
    let id = find(&service::tool_state(&conn, &detector).unwrap(), "opencode")
        .id
        .clone();

    service::update_tool(
        &conn,
        &detector,
        &id,
        input("opencode", Some(r"C:\tools\opencode-b.exe"), None),
    )
    .unwrap();

    let state = service::tool_state(&conn, &detector).unwrap();
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .expect("更新后应仍存在同一配置");
    assert!(entry
        .executable_path
        .as_deref()
        .unwrap_or_default()
        .ends_with("opencode-b.exe"));
    assert_eq!(entry.status, ToolStatus::Detected);
    assert_eq!(
        state
            .entries
            .iter()
            .filter(|entry| entry.tool_id == "opencode")
            .count(),
        1,
        "更新不应新增条目"
    );
}

#[test]
fn update_tool_rejects_unknown_id() {
    let db = memory_db();
    let conn = db.conn().unwrap();
    let detector = FakeDetector::new().with_file(r"C:\tools\opencode.exe");

    let missing = service::update_tool(
        &conn,
        &detector,
        "no-such-id",
        input("opencode", Some(r"C:\tools\opencode.exe"), None),
    )
    .unwrap_err();
    assert_eq!(missing.code, "TOOL_NOT_FOUND");
}
