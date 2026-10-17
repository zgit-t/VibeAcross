//! 针对**真实** OpenCode 的端到端验证（默认忽略，需显式运行）。
//!
//! 运行方式（本机已安装 OpenCode 时）：
//!   cargo test --test native_live -- --ignored --nocapture
//!
//! 可选环境变量 `VIBEACROSS_OPENCODE_EXE` 覆盖可执行文件路径。
//!
//! 该测试会真实启动 `opencode serve`、创建 / 查询 / 重命名 / 删除一个原生会话，
//! 并在结束时删除自己创建的会话，避免污染用户的会话列表。它验证的是完整闭环：
//! 创建 → 取得真实原生标识 → 持久化 → 枚举历史 → 恢复参数 → 归属校验。

use std::path::PathBuf;
use std::sync::Mutex;

use vibeacross_lib::db::Database;
use vibeacross_lib::launch::{LaunchError, LaunchGuard, LaunchSpec, ProcessLauncher};
use vibeacross_lib::native::{
    self, NativeBackend, NativeCreateInput, Support, SystemNativeBackend,
};
use vibeacross_lib::projects;
use vibeacross_lib::tools::detect::{Detector, SystemDetector};
use vibeacross_lib::tools::model::ToolConfigInput;
use vibeacross_lib::tools::service as tools;

#[derive(Default)]
struct RecordingLauncher {
    specs: Mutex<Vec<LaunchSpec>>,
}

impl RecordingLauncher {
    fn new() -> Self {
        Self::default()
    }

    fn last(&self) -> LaunchSpec {
        self.specs
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("没有记录到启动请求")
    }
}

impl ProcessLauncher for RecordingLauncher {
    fn launch(&self, spec: &LaunchSpec) -> Result<u32, LaunchError> {
        self.specs.lock().unwrap().push(spec.clone());
        Ok(4242)
    }
}

fn locate_opencode() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("VIBEACROSS_OPENCODE_EXE") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let default = PathBuf::from(
        r"C:\Users\ZZZ\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe",
    );
    if default.is_file() {
        return Some(default);
    }
    None
}

fn add_tool(conn: &rusqlite::Connection, detector: &dyn Detector, path: &str) -> String {
    add_tool_as(conn, detector, "opencode", path)
}

fn add_tool_as(
    conn: &rusqlite::Connection,
    detector: &dyn Detector,
    tool: &str,
    path: &str,
) -> String {
    tools::add_tool(
        conn,
        detector,
        ToolConfigInput {
            tool_id: Some(tool.to_string()),
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
        .find(|entry| entry.source != "builtin" && entry.tool_id == tool)
        .map(|entry| entry.id.clone())
        .unwrap_or_else(|| panic!("未找到刚登记的 {tool} 工具"))
}

#[test]
#[ignore = "需要本机安装 OpenCode，且会真实创建/删除原生会话；用 --ignored 显式运行"]
fn live_opencode_create_list_restore_roundtrip() {
    let Some(exe) = locate_opencode() else {
        eprintln!("未找到 OpenCode 可执行文件，跳过真实验证。");
        return;
    };
    eprintln!("使用 OpenCode: {}", exe.display());

    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();

    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let detector = SystemDetector::new();
    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool(&conn, &detector, exe.to_str().unwrap());

    let backend = SystemNativeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    // 1) 创建真实原生会话（不立即启动，避免打开 TUI）。
    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        NativeCreateInput {
            project_id: project.id.clone(),
            tool_id: tool_id.clone(),
            display_name: Some("VibeAcross 验证会话".to_string()),
            launch: false,
        },
    )
    .expect("创建原生会话失败");
    let native_id = outcome.session.native_session_id.clone().unwrap();
    assert!(!native_id.is_empty(), "原生会话标识为空");
    eprintln!("已创建原生会话: {native_id}");

    let ctx = native::tool_context(&conn, &detector, &tool_id, &project_dir).unwrap();

    // 2) 查询确认存在且属于当前项目目录。
    let found = backend.get(&ctx, &native_id).unwrap();
    assert!(found.is_some(), "刚创建的原生会话查询不到");

    // 3) 枚举历史会话应包含它。
    let listed = native::list_native(&conn, &backend, &detector, &project.id, &tool_id).unwrap();
    assert!(
        listed.iter().any(|item| item.native_id == native_id),
        "历史会话列表未包含刚创建的会话"
    );

    // 4) 幂等同步到本地记录。
    let synced = native::sync(&conn, &backend, &detector, &project.id, &tool_id).unwrap();
    assert!(synced
        .sessions
        .iter()
        .any(|session| session.native_session_id.as_deref() == Some(native_id.as_str())));

    // 5) 同步修改原生标题。
    let renamed = native::rename(
        &conn,
        &backend,
        &detector,
        &outcome.session.id,
        "VibeAcross 验证会话（已改名）",
        true,
    )
    .unwrap();
    assert!(renamed.native_renamed, "原生标题未同步");
    let after = backend.get(&ctx, &native_id).unwrap().unwrap();
    assert_eq!(after.title.as_deref(), Some("VibeAcross 验证会话（已改名）"));

    // 6) 恢复：先确认存在，再携带会话参数启动（用记录型启动器，不真正打开 TUI）。
    let restored = native::restore(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        &outcome.session.id,
    )
    .unwrap();
    assert!(restored.context_initialized);
    assert_eq!(
        launcher.last().args,
        vec!["--session".to_string(), native_id.clone()]
    );

    // 7) 归属校验：不存在的原生标识应返回 None，而不会误判存在。
    assert!(backend.get(&ctx, "ses_does_not_exist_000").unwrap().is_none());

    // 清理：删除本次验证创建的原生会话。
    backend.delete(&ctx, &native_id).unwrap();
    eprintln!("真实验证完成，已删除验证会话。");
}

fn locate_claude() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("VIBEACROSS_CLAUDE_EXE") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let default = PathBuf::from(
        r"C:\Users\ZZZ\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe",
    );
    if default.is_file() {
        return Some(default);
    }
    None
}

/// 尽力删除本机 Claude Code 中由本次验证产生的会话记录（仅删除匹配该标识的文件）。
fn cleanup_claude_transcript(native_id: &str) {
    let Some(home) = std::env::var_os("USERPROFILE") else {
        return;
    };
    let root = PathBuf::from(home).join(".claude").join("projects");
    let target = format!("{native_id}.jsonl");
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|name| name.to_str()) == Some(target.as_str()) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// 运行一次 Claude Code 非交互调用，返回（退出码、标准输出、标准错误）。
fn run_claude(
    exe: &std::path::Path,
    project_dir: &std::path::Path,
    args: &[String],
) -> (Option<i32>, String, String) {
    let output = native::proc::run_capture(
        exe,
        args,
        project_dir,
        std::time::Duration::from_secs(180),
    )
    .expect("运行 Claude Code 失败");
    (output.code, output.stdout, output.stderr)
}

#[test]
#[ignore = "需要本机安装并登录 Claude Code，且会真实调用 Anthropic API（产生费用）；用 --ignored 显式运行"]
fn live_claude_create_resume_roundtrip() {
    let Some(exe) = locate_claude() else {
        eprintln!("未找到 Claude Code 可执行文件，跳过真实验证。");
        return;
    };
    eprintln!("使用 Claude Code: {}", exe.display());

    let workspace = tempfile::tempdir().unwrap();
    let project_dir = workspace.path().join("proj");
    std::fs::create_dir(&project_dir).unwrap();

    let db = Database::open_in_memory().unwrap();
    let conn = db.conn().unwrap();
    let detector = SystemDetector::new();
    let project = projects::import_project(&conn, project_dir.to_str().unwrap(), None).unwrap();
    let tool_id = add_tool_as(&conn, &detector, "claude-code", exe.to_str().unwrap());

    let backend = SystemNativeBackend::new();
    let launcher = RecordingLauncher::new();
    let guard = LaunchGuard::new();

    // 1) 能力矩阵如实标注：创建 / 枚举 / 恢复 / 原生标识支持，改名 / 删除不支持。
    let caps = backend.capabilities("claude-code");
    assert_eq!(caps.create, Support::Supported);
    assert_eq!(caps.restore, Support::Supported);
    assert_eq!(caps.native_id, Support::Supported);
    assert_eq!(caps.list, Support::Supported);
    assert_eq!(caps.rename_title, Support::Unsupported);
    assert!(!backend.can_verify_exists("claude-code"));

    // 2) 创建：生成合法 UUID 并落库（不立即启动，避免打开交互式界面）。
    let outcome = native::create(
        &conn,
        &backend,
        &launcher,
        &guard,
        &detector,
        NativeCreateInput {
            project_id: project.id.clone(),
            tool_id: tool_id.clone(),
            display_name: Some("VibeAcross Claude 验证".to_string()),
            launch: false,
        },
    )
    .expect("创建 Claude 原生会话失败");
    let native_id = outcome.session.native_session_id.clone().unwrap();
    assert!(
        uuid::Uuid::parse_str(&native_id).is_ok(),
        "原生标识不是合法 UUID：{native_id}"
    );
    eprintln!("已分配原生会话标识: {native_id}");

    let ctx = native::tool_context(&conn, &detector, &tool_id, &project_dir).unwrap();
    assert_eq!(
        backend.create_launch_args(&ctx, &native_id).unwrap(),
        vec!["--session-id".to_string(), native_id.clone()]
    );
    assert_eq!(
        backend.restore_launch_args(&ctx, &native_id).unwrap(),
        vec!["--resume".to_string(), native_id.clone()]
    );

    // 3) 真实创建：以官方 `--session-id` 绑定标识，确认返回的 session_id 一致。
    let create_args = vec![
        "--session-id".to_string(),
        native_id.clone(),
        "-p".to_string(),
        "Reply with the single word: OK".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
    ];
    let (code, stdout, stderr) = run_claude(&exe, &project_dir, &create_args);
    let json: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("创建输出不是 JSON：{error}\nstdout={stdout}\nstderr={stderr}")
    });
    assert_eq!(code, Some(0), "创建调用未正常结束：\nstdout={stdout}\nstderr={stderr}");
    assert_eq!(
        json.get("session_id").and_then(|value| value.as_str()),
        Some(native_id.as_str()),
        "创建返回的 session_id 与分配标识不一致：\nstdout={stdout}"
    );
    assert_eq!(json.get("is_error").and_then(|value| value.as_bool()), Some(false));

    // 4) 枚举：应能从本地转录中发现刚创建的真实会话，且其归属为当前项目目录。
    let listed = native::list_native(&conn, &backend, &detector, &project.id, &tool_id)
        .expect("枚举 Claude Code 历史会话失败");
    let found_native = listed
        .iter()
        .find(|item| item.native_id == native_id)
        .expect("历史枚举未包含刚创建的真实会话");
    eprintln!(
        "枚举到 {} 条会话，命中标识 {}（目录 {:?}）",
        listed.len(),
        found_native.native_id,
        found_native.directory
    );

    // 5) 真实恢复：以官方 `--resume` 续接同一会话。
    let resume_args = vec![
        "--resume".to_string(),
        native_id.clone(),
        "-p".to_string(),
        "Reply with the single word: OK".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
    ];
    let (code, stdout, stderr) = run_claude(&exe, &project_dir, &resume_args);
    let json: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("恢复输出不是 JSON：{error}\nstdout={stdout}\nstderr={stderr}")
    });
    assert_eq!(code, Some(0), "恢复调用未正常结束：\nstdout={stdout}\nstderr={stderr}");
    assert_eq!(
        json.get("session_id").and_then(|value| value.as_str()),
        Some(native_id.as_str()),
        "恢复返回的 session_id 与目标不一致：\nstdout={stdout}"
    );

    // 6) 负例：恢复到不存在的标识应如实失败（离线，不产生 API 调用）。
    let missing_args = vec![
        "--resume".to_string(),
        "00000000-0000-4000-8000-000000000000".to_string(),
        "-p".to_string(),
        "ping".to_string(),
    ];
    let (code, stdout, stderr) = run_claude(&exe, &project_dir, &missing_args);
    let combined = format!("{stdout}\n{stderr}");
    assert_ne!(code, Some(0), "不存在的会话不应成功：\n{combined}");
    assert!(
        combined.contains("No conversation found"),
        "缺失错误信息不符合预期：\n{combined}"
    );

    // 清理：删除本次验证产生的会话记录。
    cleanup_claude_transcript(&native_id);
    eprintln!("真实验证完成，已清理验证会话记录。");
}
