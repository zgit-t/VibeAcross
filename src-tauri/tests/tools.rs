use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::tools::detect::{
    resolve_in_paths, run_version_command, DetectError, Detector, RegistryInstall, SystemDetector,
    VersionOutcome,
};
use vibeacross_lib::tools::model::{ToolConfigInput, ToolEntry, ToolState, ToolStatus, ToolType};
use vibeacross_lib::tools::service;

/// 可注入的假检测器：完全由测试控制，不触碰真实系统。
#[derive(Default)]
struct FakeDetector {
    files: Mutex<HashSet<String>>,
    commands: Mutex<HashMap<String, String>>,
    versions: Mutex<HashMap<String, String>>,
    denied: Mutex<HashSet<String>>,
    registry: Mutex<Vec<RegistryInstall>>,
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

    let candidates = [
        r"%LOCALAPPDATA%\Programs\Trae\Trae.exe",
        r"%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe",
        r"%PROGRAMFILES%\Trae\Trae.exe",
        r"%PROGRAMFILES%\Trae CN\Trae CN.exe",
    ];
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
