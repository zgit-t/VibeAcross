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
    /// 常见快捷方式目录（桌面、开始菜单）中的 `.lnk` 文件路径。
    ///
    /// 真实实现只枚举这些有界且数量有限的用户目录，**绝不扫描磁盘**；
    /// 测试用的假实现默认返回空，从而不触碰真实文件系统。
    fn shortcut_files(&self) -> Vec<PathBuf> {
        Vec::new()
    }
    /// 解析 `.lnk` 快捷方式指向的目标路径；解析失败或非快捷方式时返回 `None`。
    fn shortcut_target(&self, _lnk: &Path) -> Option<PathBuf> {
        None
    }
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

    fn shortcut_files(&self) -> Vec<PathBuf> {
        shortcut_files_in_known_dirs()
    }

    fn shortcut_target(&self, lnk: &Path) -> Option<PathBuf> {
        // 防御性大小上限：快捷方式远小于此，避免读取异常文件。
        const MAX_LNK_BYTES: u64 = 4 * 1024 * 1024;
        let metadata = std::fs::metadata(lnk).ok()?;
        if metadata.len() == 0 || metadata.len() > MAX_LNK_BYTES {
            return None;
        }
        let data = std::fs::read(lnk).ok()?;
        parse_shortcut(&data)
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

/// 枚举已知快捷方式目录中的 `.lnk` 文件（仅 Windows）。
///
/// 只访问「当前用户桌面、公共桌面、用户/公共开始菜单」这四个有界目录，
/// 并做有限深度的递归，**不遍历磁盘**。任一目录不可读时静默跳过。
#[cfg(windows)]
fn shortcut_files_in_known_dirs() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(value) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(value).join("Desktop"));
    }
    if let Some(value) = std::env::var_os("PUBLIC") {
        roots.push(PathBuf::from(value).join("Desktop"));
    }
    let start_menu = r"Microsoft\Windows\Start Menu\Programs";
    if let Some(value) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(value).join(start_menu));
    }
    if let Some(value) = std::env::var_os("PROGRAMDATA") {
        roots.push(PathBuf::from(value).join(start_menu));
    }

    let mut files = Vec::new();
    for root in roots {
        collect_lnk_files(&root, 4, &mut files);
    }
    files
}

#[cfg(not(windows))]
fn shortcut_files_in_known_dirs() -> Vec<PathBuf> {
    Vec::new()
}

/// 递归收集 `dir` 下的 `.lnk` 文件，深度受 `depth` 限制。
fn collect_lnk_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_lnk_files(&path, depth - 1, out);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("lnk"))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

/// 从 Windows Shell Link（`.lnk`）字节中解析目标可执行文件路径。
///
/// 只解析定位目标所需的最小结构：`LinkInfo`（本地基础路径 + 公共路径后缀）与
/// `ExtraData` 中的 `EnvironmentVariableDataBlock` / `DarwinDataBlock`（使用环境
/// 变量或带空间时目标存放于此）。任何越界或格式不符都安全返回 `None`，由调用
/// 方回退到其它检测方式。此函数为纯函数，便于单元测试。
pub fn parse_shortcut(data: &[u8]) -> Option<PathBuf> {
    // HeaderSize 必须为 0x4C。
    if data.len() < 76 || read_u32(data, 0)? != 0x0000_004C {
        return None;
    }
    let flags = read_u32(data, 20)?;
    let mut offset = 76usize;

    // LinkTargetIDList：跳过整体（2 字节大小 + 内容）。
    if flags & 0x0000_0001 != 0 {
        let id_list_size = read_u16(data, offset)? as usize;
        offset = offset.checked_add(2)?.checked_add(id_list_size)?;
        if offset > data.len() {
            return None;
        }
    }

    // LinkInfo：本地安装路径通常记录于此。
    if flags & 0x0000_0002 != 0 {
        if let Some(path) = parse_link_info(data, offset) {
            return Some(path);
        }
        // 即使未解析出目标，也要按其大小跳过，才能继续读取 ExtraData。
        if let Some(size) = read_u32(data, offset).map(|value| value as usize) {
            if size >= 4 {
                offset = offset.checked_add(size)?;
            }
        }
    }

    // StringData：按 LinkFlags 逐段跳过（名称 / 相对路径 / 工作目录 / 参数 / 图标）。
    let is_unicode = flags & 0x0000_0080 != 0;
    for bit in [0x0000_0004u32, 0x0000_0008, 0x0000_0010, 0x0000_0020, 0x0000_0040] {
        if flags & bit == 0 {
            continue;
        }
        let count = read_u16(data, offset)? as usize;
        let byte_len = if is_unicode { count.checked_mul(2)? } else { count };
        offset = offset.checked_add(2)?.checked_add(byte_len)?;
        if offset > data.len() {
            return None;
        }
    }

    // ExtraData：逐块扫描，识别环境变量 / Darwin 数据块中的目标路径。
    while offset + 8 <= data.len() {
        let block_size = read_u32(data, offset)? as usize;
        if block_size < 8 {
            break;
        }
        let signature = read_u32(data, offset + 4)?;
        if signature == 0xA000_0001 || signature == 0xA000_0003 {
            let base = offset + 8;
            // 前 260 字节为 ANSI 目标，紧随其后 520 字节为 UTF-16 目标。
            if base + 260 + 520 <= data.len() {
                let unicode = &data[base + 260..base + 260 + 520];
                if let Some(path) = decode_utf16_z(unicode).and_then(valid_target_path) {
                    return Some(path);
                }
                let ansi = &data[base..base + 260];
                if let Some(path) = decode_ansi_z(ansi).and_then(valid_target_path) {
                    return Some(path);
                }
            }
        }
        offset = offset.checked_add(block_size)?;
    }

    None
}

/// 解析 `LinkInfo` 结构中的本地目标路径。
fn parse_link_info(data: &[u8], start: usize) -> Option<PathBuf> {
    if start + 28 > data.len() {
        return None;
    }
    let header_size = read_u32(data, start)? as usize;
    if header_size < 28 {
        return None;
    }
    let link_info_flags = read_u32(data, start + 8)?;
    // 仅处理「本地卷 + 本地基础路径」形式；网络路径与其它形式交由上层回退。
    if link_info_flags & 0x0000_0001 == 0 {
        return None;
    }
    let local_base_path_offset = read_u32(data, start + 16)? as usize;
    let common_path_suffix_offset = read_u32(data, start + 24)? as usize;

    let mut value = String::new();
    if local_base_path_offset != 0 {
        value.push_str(&decode_ansi_z(&data[start + local_base_path_offset..])?);
    }
    if common_path_suffix_offset != 0 {
        if let Some(suffix) = decode_ansi_z(&data[start + common_path_suffix_offset..]) {
            value.push_str(&suffix);
        }
    }
    valid_target_path(value)
}

/// 校验解析出的字符串是一个绝对路径且以可执行文件扩展名结尾。
fn valid_target_path(value: String) -> Option<PathBuf> {
    let trimmed = value.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    let has_exe_ext = [".exe", ".cmd", ".bat", ".com"]
        .iter()
        .any(|ext| lowered.ends_with(ext));
    if !has_exe_ext {
        return None;
    }
    let is_absolute = trimmed.starts_with(r"\\") || trimmed.starts_with("//")
        || matches!(trimmed.as_bytes(), [d, b':', ..] if d.is_ascii_alphabetic());
    if !is_absolute {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    let slice = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes(slice.try_into().ok()?))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let slice = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(slice.try_into().ok()?))
}

/// 读取以 NUL 结尾的 ANSI（单字节）字符串。
fn decode_ansi_z(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|value| *value == 0).unwrap_or(bytes.len());
    if end == 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

/// 读取以 NUL 结尾的 UTF-16LE 字符串。
fn decode_utf16_z(bytes: &[u8]) -> Option<String> {
    let mut units = Vec::new();
    for chunk in bytes.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    if units.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(&units))
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
            if is_excluded(definition, &install) {
                continue;
            }
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

    // 桌面 / 开始菜单快捷方式：覆盖安装在自选目录、且未登记 App Paths / 卸载项的情况。
    if !definition.app_paths.is_empty() {
        for lnk in detector.shortcut_files() {
            let Some(target) = detector.shortcut_target(&lnk) else {
                continue;
            };
            let Some(file_name) = target.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let matches = definition
                .app_paths
                .iter()
                .any(|name| name.eq_ignore_ascii_case(file_name));
            if !matches {
                continue;
            }
            if detector.file_exists(&target)? {
                let lnk_name = lnk
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("快捷方式");
                return Ok(Some(build_found(
                    target,
                    format!("快捷方式（{lnk_name}）"),
                    definition,
                    detector,
                )));
            }
        }
    }

    Ok(None)
}

/// 该卸载项是否被定义明确排除（用于区分同品牌、名称互为子串的独立工具）。
fn is_excluded(definition: &ToolDefinition, install: &RegistryInstall) -> bool {
    if definition.registry_exclude_keywords.is_empty() {
        return false;
    }
    let display_name = install.display_name.to_ascii_lowercase();
    definition
        .registry_exclude_keywords
        .iter()
        .any(|keyword| display_name.contains(&keyword.to_ascii_lowercase()))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造仅含 `LinkInfo`（本地基础路径）的最小 `.lnk` 字节序列。
    fn lnk_with_local_base_path(path: &str) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&0x0000_004Cu32.to_le_bytes()); // HeaderSize
        data.extend_from_slice(&[0u8; 16]); // LinkCLSID（内容不参与解析）
        data.extend_from_slice(&0x0000_0002u32.to_le_bytes()); // LinkFlags: HasLinkInfo
        data.extend_from_slice(&[0u8; 76 - 24]); // 其余头部字段
        assert_eq!(data.len(), 76);

        let path_bytes = path.as_bytes();
        let link_info_size = (28 + path_bytes.len() + 1) as u32;
        data.extend_from_slice(&link_info_size.to_le_bytes());
        data.extend_from_slice(&28u32.to_le_bytes()); // LinkInfoHeaderSize
        data.extend_from_slice(&0x0000_0001u32.to_le_bytes()); // Flags: VolumeIDAndLocalBasePath
        data.extend_from_slice(&0u32.to_le_bytes()); // VolumeIDOffset
        data.extend_from_slice(&28u32.to_le_bytes()); // LocalBasePathOffset
        data.extend_from_slice(&0u32.to_le_bytes()); // CommonNetworkRelativeLinkOffset
        data.extend_from_slice(&0u32.to_le_bytes()); // CommonPathSuffixOffset
        data.extend_from_slice(path_bytes);
        data.push(0);
        data
    }

    #[test]
    fn parse_shortcut_reads_local_base_path() {
        let data = lnk_with_local_base_path(r"D:\Trae CN\Trae CN.exe");
        let target = parse_shortcut(&data).expect("应解析出目标路径");
        assert_eq!(target, PathBuf::from(r"D:\Trae CN\Trae CN.exe"));
    }

    #[test]
    fn parse_shortcut_reads_environment_variable_block() {
        let mut data = Vec::new();
        data.extend_from_slice(&0x0000_004Cu32.to_le_bytes());
        data.extend_from_slice(&[0u8; 16]);
        data.extend_from_slice(&0x0000_0002u32.to_le_bytes()); // HasLinkInfo
        data.extend_from_slice(&[0u8; 76 - 24]);
        // 空的 LinkInfo（大小为 4，直接被跳过）。
        data.extend_from_slice(&4u32.to_le_bytes());

        let target = r"D:\WorkBuddy\WorkBuddy.exe";
        let block_size = (8 + 260 + 520) as u32;
        data.extend_from_slice(&block_size.to_le_bytes());
        data.extend_from_slice(&0xA000_0001u32.to_le_bytes()); // EnvironmentVariableDataBlock
        let mut ansi = vec![0u8; 260];
        ansi[..target.len()].copy_from_slice(target.as_bytes());
        data.extend_from_slice(&ansi);
        let mut unicode = vec![0u8; 520];
        for (index, unit) in target.encode_utf16().enumerate() {
            let bytes = unit.to_le_bytes();
            unicode[index * 2] = bytes[0];
            unicode[index * 2 + 1] = bytes[1];
        }
        data.extend_from_slice(&unicode);

        let parsed = parse_shortcut(&data).expect("应从额外数据块解析出目标");
        assert_eq!(parsed, PathBuf::from(target));
    }

    #[test]
    fn parse_shortcut_rejects_invalid_or_non_executable_data() {
        assert!(parse_shortcut(b"not a shortcut").is_none());
        assert!(parse_shortcut(&[]).is_none());
        // 目标是目录而非可执行文件 → 拒绝。
        let data = lnk_with_local_base_path(r"D:\Trae CN\resources");
        assert!(parse_shortcut(&data).is_none());
    }
}
