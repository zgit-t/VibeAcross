//! Claude Code（`claude`）原生会话适配器。
//!
//! 能力依据：已在 Claude Code 2.1.301 本机端到端核实。
//!  - 创建：`claude --session-id <uuid>`——工具尚未提供「创建空会话」接口，
//!    因此由调用方生成一个合法 UUID 作为原生标识，交由官方 `--session-id` 绑定，
//!    会话在首次交互时落盘（经 `-p --output-format json` 确认返回的 session_id 一致）。
//!  - 恢复：`claude --resume <id>`（经 `-p --output-format json` 确认续接同一会话）。
//!  - 枚举：Claude Code 将每个会话的完整转录以 JSONL 落盘（官方文档公开路径
//!    `~/.claude/projects/<路径编码>/<sessionId>.jsonl`，可由 `CLAUDE_CONFIG_DIR` 覆盖）。
//!    本适配器只读取其中的**元数据字段**（`sessionId` / `cwd` / `summary` / `timestamp`），
//!    绝不解析消息内容，只返回会话标识、标题、所属目录与时间。
//!
//! 已知限制（如实标注，不启用）：
//!  - 改原生标题：`-n/--name` 仅在创建时可用，既有会话无命令行改名接口；
//!  - 删除：无公开接口，创建补偿回滚无法执行（上层忽略该失败）；
//!  - 存在性查询：无公开接口，恢复前不做预检，缺失判定由工具自身报告。
//!
//! 本适配器只处理会话元数据，绝不读取 / 保存任何对话内容。

use crate::error::AppError;
use serde_json::Value;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 扫描单个会话文件时最多读取的行数，避免在超长转录上做无谓的全量读取。
/// 会话标识、工作目录、标题与起始时间都出现在文件开头的元数据记录中。
const MAX_SCAN_LINES: usize = 200;

/// 生成一个新的原生会话标识（合法 UUID v4）并组装公开信息。
///
/// 标识由本应用生成，但由 Claude Code 官方 `--session-id` 公开接受并持久化，
/// 因此可作为可靠的原生会话标识。
pub fn create(ctx: &ToolContext, title: Option<&str>) -> Result<NativeSessionInfo, AppError> {
    let native_id = uuid::Uuid::new_v4().to_string();
    Ok(NativeSessionInfo {
        native_id,
        title: title.map(str::to_string),
        directory: Some(ctx.working_dir.to_string_lossy().into_owned()),
        created_at: None,
        updated_at: None,
    })
}

/// 创建后首次进入新会话所需的启动参数。
pub fn create_launch_args(native_id: &str) -> Vec<String> {
    vec!["--session-id".to_string(), native_id.to_string()]
}

/// 恢复既有会话所需的启动参数。
pub fn restore_launch_args(native_id: &str) -> Vec<String> {
    vec!["--resume".to_string(), native_id.to_string()]
}

/// 枚举当前项目目录下的历史会话（按最近使用时间倒序）。
///
/// 数据来源为 Claude Code 公开的本地转录目录。目录不存在视为「没有历史会话」；
/// 目录存在但无法读取时如实报错，绝不把读取失败伪装成空列表。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let mut items = Vec::new();
    let mut existing_root = false;
    for projects_dir in config_roots()? {
        if !projects_dir.is_dir() {
            continue;
        }
        existing_root = true;
        items.append(&mut list_projects_dir(&projects_dir, &ctx.working_dir)?);
    }
    if !existing_root {
        return Ok(Vec::new());
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

/// 带来源状态的枚举：无任何存在的转录根目录 → 来源缺失；读取失败 → 无法读取。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let roots = match config_roots() {
        Ok(roots) => roots,
        Err(_) => return Ok(HistoryListing::unreadable()),
    };
    if !roots.iter().any(|dir| dir.is_dir()) {
        return Ok(HistoryListing::source_missing());
    }
    match list(ctx) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 解析 Claude Code 的配置根目录，返回其下的 `projects` 目录（可能多个）。
///
/// 优先使用 `CLAUDE_CONFIG_DIR`（支持逗号分隔的多个根）；否则回退到用户目录下的
/// `~/.claude`。不硬编码绝对路径，也不递归扫描磁盘的其它位置。
fn config_roots() -> Result<Vec<PathBuf>, AppError> {
    if let Some(value) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        let roots: Vec<PathBuf> = value
            .to_string_lossy()
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|entry| PathBuf::from(entry).join("projects"))
            .collect();
        if !roots.is_empty() {
            return Ok(roots);
        }
    }
    let home = user_home().ok_or_else(|| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            "无法确定用户主目录，无法定位 Claude Code 的原生会话目录。",
        )
    })?;
    Ok(vec![home.join(".claude").join("projects")])
}

/// 解析当前用户主目录（Windows 优先 `USERPROFILE`，其余回退 `HOME` / `HOMEDRIVE`+`HOMEPATH`）。
fn user_home() -> Option<PathBuf> {
    for key in ["USERPROFILE", "HOME"] {
        if let Some(value) = std::env::var_os(key) {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            let mut combined = PathBuf::from(drive);
            combined.push(path);
            Some(combined)
        }
        _ => None,
    }
}

/// 读取 `projects` 目录下所有项目子目录中的会话；项目子目录整体不可读时如实报错。
///
/// 单个损坏 / 不可读的会话文件会被跳过（不致命）；但若结果是空的、且过程中出现
/// 目录级读取错误，则返回错误而非空列表。
fn list_projects_dir(
    projects_dir: &Path,
    working_dir: &Path,
) -> Result<Vec<NativeSessionInfo>, AppError> {
    let entries = std::fs::read_dir(projects_dir).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!(
                "读取 Claude Code 会话目录失败（{}）：{error}",
                projects_dir.display()
            ),
        )
    })?;
    let mut items = Vec::new();
    let mut read_error: Option<String> = None;
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(error) => {
                read_error.get_or_insert_with(|| error.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match read_project_dir(&path, working_dir) {
            Ok(mut found) => items.append(&mut found),
            Err(error) => {
                read_error.get_or_insert(error.message);
            }
        }
    }
    if items.is_empty() {
        if let Some(message) = read_error {
            return Err(AppError::new(
                "NATIVE_LIST_FAILED",
                format!("读取 Claude Code 会话失败：{message}"),
            ));
        }
    }
    Ok(items)
}

/// 读取单个项目子目录中顶层 `*.jsonl` 会话文件（跳过 `memory/`、`subagents/` 等侧文件）。
fn read_project_dir(
    project_dir: &Path,
    working_dir: &Path,
) -> Result<Vec<NativeSessionInfo>, AppError> {
    let entries = std::fs::read_dir(project_dir).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("读取会话目录失败（{}）：{error}", project_dir.display()),
        )
    })?;
    let mut items = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() || !is_jsonl(&path) {
            continue;
        }
        if let Ok(info) = read_session_file(&path) {
            if session_matches(working_dir, &info, project_dir) {
                items.push(info);
            }
        }
    }
    Ok(items)
}

/// 从单个会话文件中提取公开元数据；只读取元数据字段，不解析消息内容。
fn read_session_file(path: &Path) -> Result<NativeSessionInfo, AppError> {
    let file = std::fs::File::open(path).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("无法读取会话文件（{}）：{error}", path.display()),
        )
    })?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut title: Option<String> = None;
    let mut earliest: Option<String> = None;

    for (index, line) in reader.lines().enumerate() {
        if index >= MAX_SCAN_LINES {
            break;
        }
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if session_id.is_none() {
            session_id = string_field(&value, "sessionId");
        }
        if cwd.is_none() {
            cwd = string_field(&value, "cwd").filter(|value| !value.trim().is_empty());
        }
        if title.is_none() && value.get("type").and_then(Value::as_str) == Some("summary") {
            title = string_field(&value, "summary").filter(|value| !value.trim().is_empty());
        }
        if let Some(timestamp) = string_field(&value, "timestamp") {
            if earliest
                .as_deref()
                .map(|current| timestamp.as_str() < current)
                .unwrap_or(true)
            {
                earliest = Some(timestamp);
            }
        }
        if session_id.is_some() && cwd.is_some() && earliest.is_some() {
            break;
        }
    }

    let native_id = session_id
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_string)
        })
        .ok_or_else(|| {
            AppError::new(
                "NATIVE_LIST_FAILED",
                format!("会话文件缺少原生标识：{}", path.display()),
            )
        })?;

    Ok(NativeSessionInfo {
        native_id,
        title,
        directory: cwd,
        created_at: earliest,
        updated_at: file_modified_iso(path),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn is_jsonl(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false)
}

fn file_modified_iso(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let datetime: chrono::DateTime<chrono::Utc> = modified.into();
    Some(datetime.to_rfc3339())
}

/// 会话是否属于当前项目目录。
///
/// 优先使用转录中权威的 `cwd` 字段比对；`cwd` 缺失时才退化到项目目录名的编码比对
/// （编码规则为「非字母数字 → `-`」，与 Claude Code 一致，且它是**有损**的，
/// 因此只作为兜底，绝不据此反转出真实路径）。
fn session_matches(working_dir: &Path, info: &NativeSessionInfo, project_dir: &Path) -> bool {
    match info.directory.as_deref() {
        Some(directory) if !directory.trim().is_empty() => {
            normalize_path(directory) == normalize_path(&working_dir.to_string_lossy())
        }
        _ => project_dir
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| {
                name.eq_ignore_ascii_case(&encode_dir_name(&working_dir.to_string_lossy()))
            })
            .unwrap_or(false),
    }
}

/// 将绝对路径编码为 Claude Code 的项目目录名（非字母数字字符替换为 `-`）。
fn encode_dir_name(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect()
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn context(working_dir: &str) -> ToolContext {
        ToolContext {
            tool_id: "claude-code".to_string(),
            tool_name: "Claude Code".to_string(),
            executable: PathBuf::from("claude.exe"),
            working_dir: PathBuf::from(working_dir),
        }
    }

    fn project_dir(root: &Path, encoded: &str) -> PathBuf {
        let dir = root.join(encoded);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_returns_parseable_uuid_and_records_directory() {
        let info = create(&context(r"C:\proj"), Some("登录重构")).unwrap();
        assert!(
            uuid::Uuid::parse_str(&info.native_id).is_ok(),
            "原生标识不是合法 UUID：{}",
            info.native_id
        );
        assert_eq!(info.title.as_deref(), Some("登录重构"));
        assert_eq!(info.directory.as_deref(), Some(r"C:\proj"));
    }

    #[test]
    fn launch_args_use_official_flags() {
        assert_eq!(
            create_launch_args("abc"),
            vec!["--session-id".to_string(), "abc".to_string()]
        );
        assert_eq!(
            restore_launch_args("abc"),
            vec!["--resume".to_string(), "abc".to_string()]
        );
    }

    #[test]
    fn lists_sessions_from_matching_project_and_reads_metadata() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let target = project_dir(&projects, "D--works-VibeAcross");
        fs::write(
            target.join("3fa8cd63-dae2-494e-98d5-34b1b520549a.jsonl"),
            concat!(
                "{\"type\":\"mode\",\"mode\":\"normal\",\"sessionId\":\"3fa8cd63-dae2-494e-98d5-34b1b520549a\"}\n",
                "{\"type\":\"summary\",\"summary\":\"修复登录\",\"leafUuid\":\"x\"}\n",
                "{\"type\":\"user\",\"sessionId\":\"3fa8cd63-dae2-494e-98d5-34b1b520549a\",\"cwd\":\"D:\\\\works\\\\VibeAcross\",\"timestamp\":\"2026-10-16T17:33:41.537Z\",\"message\":{\"content\":\"秘密内容\"}}\n",
                "{\"type\":\"assistant\",\"timestamp\":\"2026-10-16T17:35:00.000Z\"}\n",
            ),
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        let info = &items[0];
        assert_eq!(info.native_id, "3fa8cd63-dae2-494e-98d5-34b1b520549a");
        assert_eq!(info.title.as_deref(), Some("修复登录"));
        assert_eq!(info.directory.as_deref(), Some(r"D:\works\VibeAcross"));
        assert_eq!(info.created_at.as_deref(), Some("2026-10-16T17:33:41.537Z"));
        assert!(info.updated_at.is_some());
    }

    #[test]
    fn excludes_sessions_belonging_to_other_projects() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let other = project_dir(&projects, "C--Users-ZZZ");
        fs::write(
            other.join("11111111-1111-4111-8111-111111111111.jsonl"),
            "{\"type\":\"user\",\"sessionId\":\"11111111-1111-4111-8111-111111111111\",\"cwd\":\"C:\\\\Users\\\\ZZZ\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}\n",
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert!(items.is_empty(), "不应混入其它项目的会话");
    }

    #[test]
    fn matches_cwd_ignoring_case_and_separators() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let target = project_dir(&projects, "C--Work-Proj");
        fs::write(
            target.join("22222222-2222-4222-8222-222222222222.jsonl"),
            "{\"sessionId\":\"22222222-2222-4222-8222-222222222222\",\"cwd\":\"c:/work/proj/\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}\n",
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"C:\Work\Proj")).unwrap();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn falls_back_to_filename_when_session_id_missing() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let target = project_dir(&projects, "D--works-VibeAcross");
        fs::write(
            target.join("abcd-uuid.jsonl"),
            "{\"type\":\"mode\",\"mode\":\"normal\"}\n",
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "abcd-uuid");
        assert!(items[0].directory.is_none());
    }

    #[test]
    fn ignores_side_directories_and_non_jsonl_files() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let target = project_dir(&projects, "D--works-VibeAcross");
        fs::create_dir_all(target.join("3fa8cd63-dae2-494e-98d5-34b1b520549a")).unwrap();
        fs::write(target.join("memory"), "not a session").unwrap();
        fs::write(target.join("notes.txt"), "not a session").unwrap();
        fs::write(
            target.join("33333333-3333-4333-8333-333333333333.jsonl"),
            "{\"sessionId\":\"33333333-3333-4333-8333-333333333333\",\"cwd\":\"D:\\\\works\\\\VibeAcross\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}\n",
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "33333333-3333-4333-8333-333333333333");
    }

    #[test]
    fn malformed_lines_are_ignored_not_fatal() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let target = project_dir(&projects, "D--works-VibeAcross");
        fs::write(
            target.join("44444444-4444-4444-8444-444444444444.jsonl"),
            concat!(
                "not json at all\n",
                "{\"sessionId\":\"44444444-4444-4444-8444-444444444444\",\"cwd\":\"D:\\\\works\\\\VibeAcross\",\"timestamp\":\"2026-10-16T17:00:00.000Z\"}\n",
            ),
        )
        .unwrap();

        let items = list_projects_dir(&projects, Path::new(r"D:\works\VibeAcross")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, "44444444-4444-4444-8444-444444444444");
    }

    #[test]
    fn unreadable_projects_dir_is_reported_as_error() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("projects");
        assert!(
            list_projects_dir(&missing, Path::new(r"D:\works\VibeAcross")).is_err(),
            "目录不可读应如实报错，而不是伪装成空列表"
        );
    }

    #[test]
    fn encode_dir_name_matches_claude_convention() {
        assert_eq!(
            encode_dir_name(r"D:\works\VibeAcross"),
            "D--works-VibeAcross"
        );
        assert_eq!(
            encode_dir_name("/Users/me/proj"),
            "-Users-me-proj"
        );
    }
}
