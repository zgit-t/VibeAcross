use crate::tools::catalog::ToolDefinition;
use crate::tools::model::ToolType;
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 检测过程中的可预期错误（权限不足、系统调用失败等）。
#[derive(Debug, Clone)]
pub struct DetectError {
    pub message: String,
}

impl DetectError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for DetectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for DetectError {}

/// 版本查询结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionOutcome {
    Value(String),
    /// 该可执行文件类型不支持安全查询（例如 `.cmd`/`.bat` 需要 shell）。
    Unsupported,
    Failed(String),
    Timeout,
}

/// 注册表卸载项中提取的安装信息。
#[derive(Debug, Clone, Default)]
pub struct RegistryInstall {
    pub display_name: String,
    pub install_location: Option<String>,
    pub display_icon: Option<String>,
}

impl RegistryInstall {
    /// 从 `DisplayIcon` 解析可执行文件路径（形如 `"C:\App\app.exe",0`）。
    pub fn exe_path(&self) -> Option<PathBuf> {
        let icon = self.display_icon.as_deref()?;
        let cleaned = clean_icon_path(icon)?;
        if cleaned.to_ascii_lowercase().ends_with(".exe") {
            Some(PathBuf::from(cleaned))
        } else {
            None
        }
    }
}

fn clean_icon_path(raw: &str) -> Option<String> {
    let mut value = raw.trim().to_string();
    if value.contains('%') {
        value = crate::tools::catalog::expand_candidate(&value)?;
    }
    value = value.trim_matches('"').trim().to_string();
    if let Some(index) = value.rfind(',') {
        let tail = value[index + 1..].trim();
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            value.truncate(index);
        }
    }
    let value = value.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// 检测结果。
#[derive(Debug, Clone)]
pub struct Found {
    pub path: PathBuf,
    /// 识别方式（用于向用户解释证据来源）。
    pub method: String,
    pub version: Option<String>,
    /// 非致命警告（例如版本查询超时）。
    pub warning: Option<String>,
}

/// 可注入的检测服务。
///
/// 真实实现访问系统（PATH、文件系统、注册表、子进程）；测试使用假实现，
/// 从而避免在测试中修改用户真实环境。
pub trait Detector: Send + Sync {
    fn file_exists(&self, path: &Path) -> Result<bool, DetectError>;
    fn resolve_command(&self, name: &str) -> Option<PathBuf>;
    fn registry_installs(&self, keywords: &[&str]) -> Vec<RegistryInstall>;
    /// 读取注册表 `App Paths` 中某个可执行文件名登记的真实路径（精确匹配）。
    fn app_path(&self, exe_name: &str) -> Option<PathBuf>;
    fn query_version(&self, executable: &Path, args: &[&str]) -> VersionOutcome;
}

/// 在给定 PATH 与 PATHEXT 下解析命令，偏好 `.exe`。
pub fn resolve_in_paths(name: &str, path_env: &OsStr, pathext: &str) -> Option<PathBuf> {
    if name.trim().is_empty() {
        return None;
    }

    let mut extensions: Vec<String> = Vec::new();
    if Path::new(name).extension().is_some() {
        extensions.push(String::new());
    }
    for preferred in [".exe", ".cmd", ".bat", ".com"] {
        if !extensions.iter().any(|e| e.eq_ignore_ascii_case(preferred)) {
            extensions.push(preferred.to_string());
        }
    }
    for part in pathext.split(';') {
        let extension = part.trim();
        if extension.is_empty() {
            continue;
        }
        if !extensions.iter().any(|e| e.eq_ignore_ascii_case(extension)) {
            extensions.push(extension.to_string());
        }
    }

    for dir in std::env::split_paths(path_env) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for extension in &extensions {
            let candidate = if extension.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}{extension}"))
            };
            if candidate.is_file() {
                return Some(std::fs::canonicalize(&candidate).unwrap_or(candidate));
            }
        }
    }

    None
}

/// 真实系统检测实现。
pub struct SystemDetector;

impl SystemDetector {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Detector for SystemDetector {
    fn file_exists(&self, path: &Path) -> Result<bool, DetectError> {
        match std::fs::metadata(path) {
            Ok(metadata) => Ok(metadata.is_file()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => Err(DetectError::new(
                format!("访问路径被拒绝：{}", path.display()),
            )),
            Err(_) => Ok(false),
        }
    }

    fn resolve_command(&self, name: &str) -> Option<PathBuf> {
        let path_env = std::env::var_os("PATH")?;
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        resolve_in_paths(name, &path_env, &pathext)
    }

    fn registry_installs(&self, keywords: &[&str]) -> Vec<RegistryInstall> {
        system_registry_installs(keywords)
    }

    fn app_path(&self, exe_name: &str) -> Option<PathBuf> {
        system_app_path(exe_name)
    }

    fn query_version(&self, executable: &Path, args: &[&str]) -> VersionOutcome {
        let extension = executable
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        // 仅对可直接执行的二进制查询版本；`.cmd`/`.bat` 需要 shell，出于安全考虑跳过。
        if extension != "exe" && extension != "com" {
            return VersionOutcome::Unsupported;
        }
        run_version_command(executable, args, Duration::from_secs(4))
    }
}

/// 运行受控的版本查询命令，带超时保护。
///
/// 参数来自内置目录定义（固定为 `--version` 等），绝不拼接用户输入。
pub fn run_version_command(executable: &Path, args: &[&str], timeout: Duration) -> VersionOutcome {
    let mut child = match Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return VersionOutcome::Failed(format!("无法启动：{error}")),
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let mut err = String::new();
        if let Some(mut handle) = stdout {
            let _ = handle.read_to_string(&mut out);
        }
        if let Some(mut handle) = stderr {
            let _ = handle.read_to_string(&mut err);
        }
        (out, err)
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let (out, err) = reader.join().unwrap_or_default();
                return interpret_version_output(status.success(), &out, &err);
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return VersionOutcome::Timeout;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => {
                let _ = reader.join();
                return VersionOutcome::Failed(format!("等待进程失败：{error}"));
            }
        }
    }
}

fn interpret_version_output(success: bool, stdout: &str, stderr: &str) -> VersionOutcome {
    let source = if stdout.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    let line = source
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if line.is_empty() {
        if success {
            VersionOutcome::Failed("命令未返回版本信息。".to_string())
        } else {
            VersionOutcome::Failed("命令以非零状态码退出。".to_string())
        }
    } else {
        VersionOutcome::Value(line.chars().take(160).collect())
    }
}

#[cfg(windows)]
fn system_registry_installs(keywords: &[&str]) -> Vec<RegistryInstall> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut results = Vec::new();
    if keywords.is_empty() {
        return results;
    }
    let lowered: Vec<String> = keywords.iter().map(|k| k.to_lowercase()).collect();

    let roots = [
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];

    for (hive, subkey) in roots {
        let root = RegKey::predef(hive);
        let Ok(key) = root.open_subkey(subkey) else {
            // 权限不足或不存在时跳过该根键，不影响其他检测方式。
            continue;
        };
        for name in key.enum_keys().flatten() {
            let Ok(item) = key.open_subkey(&name) else {
                continue;
            };
            let display_name: String = item.get_value("DisplayName").unwrap_or_default();
            if display_name.is_empty() {
                continue;
            }
            let lowered_name = display_name.to_lowercase();
            if !lowered.iter().any(|keyword| lowered_name.contains(keyword)) {
                continue;
            }
            results.push(RegistryInstall {
                display_name,
                install_location: item.get_value("InstallLocation").ok(),
                display_icon: item.get_value("DisplayIcon").ok(),
            });
        }
    }

    results
}

#[cfg(not(windows))]
fn system_registry_installs(_keywords: &[&str]) -> Vec<RegistryInstall> {
    Vec::new()
}

/// 从注册表 `App Paths` 读取指定可执行文件名登记的真实路径。
///
/// 只做精确文件名匹配，不枚举、不模糊搜索；缺失或权限不足时返回 `None`，
/// 交由其它检测方式继续，绝不因此判定为「未安装」。
#[cfg(windows)]
fn system_app_path(exe_name: &str) -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let name = exe_name.trim();
    if name.is_empty() {
        return None;
    }

    let roots = [
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\App Paths",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\App Paths",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths",
        ),
    ];

    for (hive, subkey) in roots {
        let root = RegKey::predef(hive);
        let Ok(key) = root.open_subkey(subkey) else {
            continue;
        };
        let Ok(entry) = key.open_subkey(name) else {
            continue;
        };
        // 默认值即登记的可执行文件路径（可能带引号或 `%VAR%`）。
        let Ok(raw) = entry.get_value::<String, _>("") else {
            continue;
        };
        if let Some(cleaned) = clean_icon_path(&raw) {
            if !cleaned.is_empty() {
                return Some(PathBuf::from(cleaned));
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn system_app_path(_exe_name: &str) -> Option<PathBuf> {
    None
}

/// 对单个内置定义执行检测。
pub fn detect_definition(
    definition: &ToolDefinition,
    detector: &dyn Detector,
) -> Result<Option<Found>, DetectError> {
    if definition.tool_type == ToolType::Cli {
        for command in definition.commands {
            if let Some(path) = detector.resolve_command(command) {
                return Ok(Some(build_found(
                    path,
                    format!("PATH 命令 `{command}`"),
                    definition,
                    detector,
                )));
            }
        }
    }

    for raw in definition.candidate_paths {
        if let Some(expanded) = crate::tools::catalog::expand_candidate(raw) {
            let path = PathBuf::from(&expanded);
            if detector.file_exists(&path)? {
                return Ok(Some(build_found(
                    path,
                    "候选安装路径".to_string(),
                    definition,
                    detector,
                )));
            }
        }
    }

    // 注册表 App Paths：覆盖安装目录由用户自选、不在候选路径中的情况。
    for exe_name in definition.app_paths {
        if let Some(path) = detector.app_path(exe_name) {
            if detector.file_exists(&path)? {
                return Ok(Some(build_found(
                    path,
                    format!("App Paths 注册表项（{exe_name}）"),
                    definition,
                    detector,
                )));
            }
        }
    }

    if !definition.registry_keywords.is_empty() {
        for install in detector.registry_installs(definition.registry_keywords) {
            if let Some(executable) = install.exe_path() {
                if detector.file_exists(&executable)? {
                    return Ok(Some(build_found(
                        executable,
                        "卸载注册表项".to_string(),
                        definition,
                        detector,
                    )));
                }
            }
        }
    }

    Ok(None)
}

fn build_found(
    path: PathBuf,
    method: String,
    definition: &ToolDefinition,
    detector: &dyn Detector,
) -> Found {
    let mut version = None;
    let mut warning = None;

    if !definition.version_args.is_empty() {
        match detector.query_version(&path, definition.version_args) {
            VersionOutcome::Value(value) => version = Some(value),
            VersionOutcome::Unsupported => {}
            VersionOutcome::Timeout => {
                warning = Some("版本查询超时，已仅依据路径识别。".to_string())
            }
            VersionOutcome::Failed(error) => warning = Some(format!("版本查询失败：{error}")),
        }
    }

    Found {
        path,
        method,
        version,
        warning,
    }
}
