//! 项目与开发工具的关联，以及受控的工具启动。
//!
//! 设计要点：
//!  - 前端只能提交「项目 id + 工具安装 id」，绝不能传入任意命令或参数。
//!  - 启动前重新校验项目目录与工具可执行文件的有效性。
//!  - 只使用标准库的进程 API：`.exe` 直接创建进程；`.cmd`/`.bat` 仅经受控的
//!    Windows 命令解释器启动（结构化引用，不拼接原始 shell 字符串）。
//!  - 通过 [`ProcessLauncher`] 抽象进程创建，测试可注入记录型实现而不真正启动进程。

use crate::error::AppError;
use crate::models::Project;
use crate::projects;
use crate::tools::detect::Detector;
use crate::tools::model::{
    command_script_unsafe_char, is_command_script, LaunchMethod, LaunchSupport,
};
use crate::tools::service as tools;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 同一「项目 + 工具」在此时间窗内的重复启动会被拒绝。
///
/// 这是防止界面重复点击 / 重复请求的**防抖**，并不是对已运行进程的可靠检测。
const DUPLICATE_WINDOW: Duration = Duration::from_secs(2);

/// 进程创建方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    /// 独立启动（桌面应用），不显示控制台窗口。
    Detached,
    /// 在新的控制台窗口中启动（命令行工具）。
    Console,
}

/// 受控启动的目标类型。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchTarget {
    /// 直接创建可执行文件进程（`.exe` 等）。
    Direct,
    /// 经指定的 Windows 命令解释器启动 `.cmd` / `.bat` 脚本。
    ///
    /// cmd.exe 不按 CRT 规则解析引号，因此脚本路径与参数必须走独立的安全
    /// 构造逻辑（见 [`command_script_argv`]），绝不交给标准库转义或拼接 shell 字符串。
    CommandScript { interpreter: PathBuf },
}

/// 一次受控启动的完整描述。
#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub working_dir: PathBuf,
    pub mode: LaunchMode,
    pub target: LaunchTarget,
}

/// 进程创建失败。
#[derive(Debug, Clone)]
pub struct LaunchError {
    pub message: String,
}

impl LaunchError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// 受控进程创建抽象。生产实现为 [`SystemLauncher`]，测试注入记录型实现。
pub trait ProcessLauncher: Send + Sync {
    /// 创建进程并返回其 pid。注意：**进程已创建并不代表工具已成功初始化**。
    fn launch(&self, spec: &LaunchSpec) -> Result<u32, LaunchError>;
}

/// 使用标准库 `std::process` 的真实进程创建实现。
#[derive(Debug, Default)]
pub struct SystemLauncher;

impl SystemLauncher {
    pub fn new() -> Self {
        Self
    }
}

/// 定位 Windows 命令解释器：优先使用 `%ComSpec%`，否则回退到系统默认路径。
pub fn windows_command_interpreter() -> PathBuf {
    if let Some(value) = std::env::var_os("ComSpec") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    #[cfg(windows)]
    {
        PathBuf::from(r"C:\Windows\System32\cmd.exe")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("cmd.exe")
    }
}

/// 用双引号包裹单个 cmd token；包含无法安全转义的字符时拒绝。
fn quote_cmd_token(raw: &str) -> Result<String, LaunchError> {
    if raw.is_empty() {
        return Err(LaunchError::new("脚本路径或参数为空，无法安全启动。"));
    }
    if let Some(bad) = command_script_unsafe_char(raw) {
        return Err(LaunchError::new(format!(
            "路径或参数包含无法安全转义的字符「{bad}」，已拒绝经命令解释器启动。"
        )));
    }
    Ok(format!("\"{raw}\""))
}

/// 为 `.cmd` / `.bat` 构造经 Windows 命令解释器启动的参数列表。
///
/// 返回 `["/d", "/v:off", "/s", "/c", <命令字符串>]`：
/// - `/d` 忽略 AutoRun 注册表项；`/v:off` 关闭延迟展开，使 `!` 失去特殊含义；
/// - `/s` 让 cmd 去掉命令字符串首尾的引号，因此整条命令再包一层引号；
/// - 每个 token 用双引号包裹并拒绝无法安全转义的字符，正确处理空格与
///   `& | < > ^` 等 cmd 元字符。
///
/// 该函数不接收任何未经验证的原始命令行，只对结构化的路径与参数做引用。
pub fn command_script_argv(script: &Path, args: &[String]) -> Result<Vec<String>, LaunchError> {
    let script = script
        .to_str()
        .ok_or_else(|| LaunchError::new("脚本路径不是有效的 Unicode 字符串。"))?;
    let mut tokens = Vec::with_capacity(args.len() + 1);
    tokens.push(quote_cmd_token(script)?);
    for arg in args {
        tokens.push(quote_cmd_token(arg)?);
    }
    let command = format!("\"{}\"", tokens.join(" "));
    Ok(vec![
        "/d".to_string(),
        "/v:off".to_string(),
        "/s".to_string(),
        "/c".to_string(),
        command,
    ])
}

impl ProcessLauncher for SystemLauncher {
    fn launch(&self, spec: &LaunchSpec) -> Result<u32, LaunchError> {
        let mut command = match &spec.target {
            LaunchTarget::Direct => {
                let mut command = Command::new(&spec.executable);
                command.args(&spec.args);
                command
            }
            LaunchTarget::CommandScript { interpreter } => {
                let argv = command_script_argv(&spec.executable, &spec.args)?;
                let mut command = Command::new(interpreter);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    // 命令字符串必须**原样**追加：cmd.exe 不按 CRT 规则解析引号，
                    // 若交由标准库转义会破坏 `.cmd` 的引用语义、甚至造成注入。
                    for item in &argv {
                        command.raw_arg(item);
                    }
                }
                #[cfg(not(windows))]
                {
                    command.args(&argv);
                }
                command
            }
        };

        command.current_dir(&spec.working_dir);

        match spec.mode {
            LaunchMode::Detached => {
                // 桌面应用独立启动：不占用父进程的标准流，避免继承无效句柄。
                command.stdin(Stdio::null());
                command.stdout(Stdio::null());
                command.stderr(Stdio::null());
            }
            LaunchMode::Console => {
                // 不覆盖标准句柄：交给新的控制台窗口，命令行工具的交互界面才会显示。
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // 不经过 shell 文本拼接，仅通过进程创建标志控制窗口行为。
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let flags = match spec.mode {
                LaunchMode::Console => CREATE_NEW_CONSOLE,
                LaunchMode::Detached => CREATE_NO_WINDOW,
            };
            command.creation_flags(flags);
        }

        let child = command
            .spawn()
            .map_err(|error| LaunchError::new(format!("操作系统拒绝启动该进程：{error}")))?;
        Ok(child.id())
    }
}

/// 记录最近启动时间，用于拒绝短时间内的重复启动请求。
#[derive(Debug, Default)]
pub struct LaunchGuard {
    recent: Mutex<HashMap<String, Instant>>,
}

impl LaunchGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// 允许启动时返回 true 并记录时间；窗口期内重复则返回 false。
    fn allow(&self, key: &str) -> bool {
        let mut recent = self
            .recent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        recent.retain(|_, at| now.duration_since(*at) < DUPLICATE_WINDOW);
        if recent.contains_key(key) {
            return false;
        }
        recent.insert(key.to_string(), now);
        true
    }

    fn forget(&self, key: &str) {
        let mut recent = self
            .recent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        recent.remove(key);
    }
}

/// 成功的启动结果。仅表示**进程已创建**，不代表工具已完成初始化。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub project_id: String,
    pub project_name: String,
    pub tool_id: String,
    pub tool_name: String,
    pub pid: u32,
    pub method: LaunchMethod,
    pub working_dir: String,
    pub arguments: Vec<String>,
    /// 本次启动是否同时在目标工具中创建 / 恢复了任务或会话上下文。
    ///
    /// 当前版本不向工具传递任何会话或上下文参数，因此恒为 `false`；
    /// 界面据此如实告知用户需在工具内手动继续，避免把「进程已创建」误当作
    /// 「任务已初始化」。
    pub context_initialized: bool,
}

/// 为项目设置默认开发工具；`tool_id` 为 None 时清除关联。
///
/// 只允许关联「已检测到」的工具安装；引用完整性由后端保证。
pub fn set_project_tool(
    conn: &Connection,
    project_id: &str,
    tool_id: Option<&str>,
    detector: &dyn Detector,
) -> Result<Project, AppError> {
    projects::get_project(conn, project_id)?;

    let target = tool_id.map(str::trim).filter(|value| !value.is_empty());
    if let Some(id) = target {
        let state = tools::tool_state(conn, detector)?;
        let entry = state
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| {
                AppError::new("TOOL_NOT_FOUND", "未找到该开发工具配置，请重新选择。")
            })?;
        if !entry.installed {
            return Err(AppError::new("TOOL_NOT_READY", entry.launch.reason.clone()));
        }
    }

    projects::set_default_tool(conn, project_id, target)
}

/// 清除所有指向指定工具安装的项目关联与工作上下文引用。
///
/// 在删除工具安装后调用，避免项目或工作上下文引用到一个已不存在的配置；
/// 工作上下文仅把 `tool_id` 置空，记录本身仍然保留。
pub fn clear_tool_references(conn: &Connection, tool_id: &str) -> Result<usize, AppError> {
    let tx = conn.unchecked_transaction()?;
    let now = crate::now_iso();
    let affected = tx.execute(
        "UPDATE projects SET default_tool_id = NULL, updated_at = ?1 WHERE default_tool_id = ?2",
        params![now, tool_id],
    )?;
    tx.execute(
        "UPDATE workspace_sessions SET tool_id = NULL, updated_at = ?1 WHERE tool_id = ?2",
        params![now, tool_id],
    )?;
    tx.commit()?;
    Ok(affected)
}

/// 在指定项目目录中启动工具。
///
/// `tool_id` 显式指定时用于本次启动并记为项目默认；为 None 时使用项目已保存的默认工具。
pub fn launch(
    conn: &Connection,
    launcher: &dyn ProcessLauncher,
    guard: &LaunchGuard,
    project_id: &str,
    tool_id: Option<&str>,
    detector: &dyn Detector,
) -> Result<LaunchResult, AppError> {
    let project = projects::get_project(conn, project_id)?;

    let explicit = tool_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let target_id = explicit
        .clone()
        .or_else(|| project.default_tool_id.clone())
        .ok_or_else(|| AppError::new("TOOL_CONFIG_REQUIRED", "请先为该项目选择开发工具。"))?;

    // 启动前重新确认项目目录存在、为目录且可访问。
    let project_dir = Path::new(&project.path);
    let metadata = std::fs::metadata(project_dir).map_err(|_| {
        AppError::new(
            "PROJECT_PATH_MISSING",
            format!("项目目录不存在或不可访问：{}", project.path),
        )
    })?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "PROJECT_PATH_NOT_DIR",
            format!("项目路径不是目录：{}", project.path),
        ));
    }
    if let Err(error) = std::fs::read_dir(project_dir) {
        return Err(AppError::new(
            "PROJECT_PATH_INACCESSIBLE",
            format!("项目目录不可访问：{error}"),
        ));
    }

    let state = tools::tool_state(conn, detector)?;
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.id == target_id)
        .ok_or_else(|| AppError::new("TOOL_NOT_FOUND", "未找到该项目选择的开发工具，请重新选择。"))?;

    // 只允许启动已配置且经过校验的工具；否则返回可操作的原因。
    let method = match entry.launch.support {
        LaunchSupport::Supported => entry.launch.method.ok_or_else(|| {
            AppError::new("LAUNCH_UNSUPPORTED", "该工具没有可用的启动方式。")
        })?,
        LaunchSupport::Unavailable => {
            return Err(AppError::new("TOOL_NOT_READY", entry.launch.reason.clone()))
        }
        LaunchSupport::NeedsConfiguration => {
            return Err(AppError::new(
                "LAUNCH_NEEDS_CONFIGURATION",
                entry.launch.reason.clone(),
            ))
        }
        LaunchSupport::Unsupported => {
            return Err(AppError::new(
                "LAUNCH_UNSUPPORTED",
                entry.launch.reason.clone(),
            ))
        }
    };

    // 校验可执行文件路径。
    let executable = entry
        .executable_path
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("TOOL_CONFIG_REQUIRED", "该工具缺少可执行文件路径。"))?;
    let executable_path = PathBuf::from(&executable);
    match std::fs::metadata(&executable_path) {
        Ok(found) if found.is_file() => {}
        Ok(_) => {
            return Err(AppError::new(
                "PATH_NOT_A_FILE",
                format!("工具路径不是文件：{executable}"),
            ))
        }
        Err(_) => {
            return Err(AppError::new(
                "PATH_NOT_FOUND",
                format!("工具可执行文件不存在：{executable}"),
            ))
        }
    }

    // 不同工具类型使用不同的启动方式，绝不共用一套参数。
    let (args, mode) = match method {
        LaunchMethod::FolderArgument => (vec![project.path.clone()], LaunchMode::Detached),
        LaunchMethod::WorkingDirectory => (Vec::new(), LaunchMode::Console),
    };

    // `.cmd` / `.bat` 无法直接创建进程，必须经 Windows 命令解释器启动。
    let target = if is_command_script(&executable_path) {
        // 防御性校验：即使配置阶段已检查，启动前仍拒绝无法安全转义的路径 / 参数。
        let unsafe_char = command_script_unsafe_char(&executable)
            .or_else(|| args.iter().find_map(|arg| command_script_unsafe_char(arg)));
        if let Some(bad) = unsafe_char {
            return Err(AppError::new(
                "LAUNCH_UNSAFE_PATH",
                format!(
                    "路径或参数包含无法安全转义的字符「{bad}」，出于安全考虑已拒绝经命令解释器启动；请改用 .exe 形式或调整安装路径。"
                ),
            ));
        }
        LaunchTarget::CommandScript {
            interpreter: windows_command_interpreter(),
        }
    } else {
        LaunchTarget::Direct
    };

    let key = format!("{project_id}:{target_id}");
    if !guard.allow(&key) {
        return Err(AppError::new(
            "LAUNCH_DUPLICATE",
            "该项目刚刚已启动同一个工具，请稍候再试。",
        ));
    }

    let spec = LaunchSpec {
        executable: executable_path,
        args: args.clone(),
        working_dir: project_dir.to_path_buf(),
        mode,
        target,
    };

    let pid = match launcher.launch(&spec) {
        Ok(pid) => pid,
        Err(error) => {
            guard.forget(&key);
            return Err(AppError::new("LAUNCH_FAILED", error.message));
        }
    };

    // 显式指定了工具时记入项目默认，方便下次一键启动。
    if explicit.is_some() && project.default_tool_id.as_deref() != Some(target_id.as_str()) {
        let _ = projects::set_default_tool(conn, project_id, Some(&target_id));
    }

    Ok(LaunchResult {
        project_id: project.id,
        project_name: project.name,
        tool_id: target_id,
        tool_name: entry.name.clone(),
        pid,
        method,
        working_dir: project.path.clone(),
        arguments: args,
        // 当前版本只创建进程并定位工作目录，不注入任何会话 / 上下文参数。
        context_initialized: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn command_script_argv_quotes_script_with_spaces() {
        let argv = command_script_argv(Path::new(r"C:\Program Files\npm\claude.cmd"), &[]).unwrap();
        assert_eq!(argv[0], "/d");
        assert_eq!(argv[1], "/v:off");
        assert_eq!(argv[2], "/s");
        assert_eq!(argv[3], "/c");
        // `/s` 会去掉首尾引号，因此整条命令再包一层引号。
        assert_eq!(argv[4], "\"\"C:\\Program Files\\npm\\claude.cmd\"\"");
    }

    #[test]
    fn command_script_argv_quotes_each_argument() {
        let argv =
            command_script_argv(Path::new(r"C:\tools\x.cmd"), &args(&[r"C:\my project"])).unwrap();
        assert_eq!(argv[4], "\"\"C:\\tools\\x.cmd\" \"C:\\my project\"\"");
    }

    #[test]
    fn command_script_argv_rejects_unsafe_tokens() {
        assert!(command_script_argv(Path::new(r"C:\a%b\tool.cmd"), &[]).is_err());
        assert!(command_script_argv(Path::new(r#"C:\a"b\tool.cmd"#), &[]).is_err());
        assert!(command_script_argv(Path::new(r"C:\tools\x.cmd"), &args(&["%"])).is_err());
    }

    #[test]
    fn command_script_argv_rejects_empty_argument() {
        assert!(command_script_argv(Path::new(r"C:\tools\x.cmd"), &args(&[""])).is_err());
    }
}
