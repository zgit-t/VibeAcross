//! Cursor 桌面编辑器的原生会话**只读**适配器。
//!
//! 能力依据：Cursor 为桌面编辑器（本机已确认其 `cursor.cmd` 只是 VS Code 风格的
//! 目录 / 文件打开器，没有创建 / 恢复 AI 会话的命令行接口），因此**不提供**
//! 创建 / 恢复 / 改名 / 删除。历史会话来自 Cursor 在本机落盘的数据：
//!
//! ```text
//! ~/.cursor/projects/<工作区目录编码>/agent-transcripts/<会话id>/<会话id>.jsonl
//! ```
//!
//! - 会话标识：`agent-transcripts` 下的 UUID 目录 / 文件名的 UUID；
//! - 归属项目：由 `<工作区目录编码>` 正向比对当前项目目录（编码有损，只做匹配）；
//! - 标题：优先取转录中**首条有效用户消息**清理后的文本；无法取得时留空，
//!   交由上层回退为「会话 <短ID>」。
//!
//! 本适配器只读取转录文件开头的少量行以提取标识、标题与起始时间，
//! 不保存、不外发任何对话正文。

use chrono::TimeZone;
use serde_json::Value;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::error::AppError;

use super::common;
use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 扫描单个转录文件时最多读取的行数。
const MAX_SCAN_LINES: usize = 200;

/// 生成标题时的最大字符数。
const TITLE_MAX_CHARS: usize = 80;

/// 枚举当前项目目录下的 Cursor 历史会话（按更新时间倒序）。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let home = common::user_home().ok_or_else(|| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            "无法确定用户主目录，无法定位 Cursor 的本地会话目录。",
        )
    })?;
    let projects = home.join(".cursor").join("projects");
    list_in(&projects, &ctx.working_dir)
}

/// 带来源状态的枚举：根目录不存在视为「来源缺失」，读取失败视为「无法读取」。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let Some(home) = common::user_home() else {
        return Ok(HistoryListing::unreadable());
    };
    let projects = home.join(".cursor").join("projects");
    if !projects.is_dir() {
        return Ok(HistoryListing::source_missing());
    }
    match list_in(&projects, &ctx.working_dir) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 从给定的 `projects` 根目录枚举归属 `working_dir` 的会话（便于受控测试）。
///
/// 根目录不存在视为「没有历史会话」；根目录存在但不可读时如实报错，
/// 绝不把读取失败伪装成空列表。
pub(crate) fn list_in(
    projects: &Path,
    working_dir: &Path,
) -> Result<Vec<NativeSessionInfo>, AppError> {
    if !projects.is_dir() {
        return Ok(Vec::new());
    }
    let target = common::encode_dir_name(&working_dir.to_string_lossy());
    let entries = std::fs::read_dir(projects).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("读取 Cursor 会话根目录失败（{}）：{error}", projects.display()),
        )
    })?;

    let mut items: Vec<NativeSessionInfo> = Vec::new();
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
        // Cursor 的目录编码大小写不稳定，因此统一小写后比对。
        if entry.file_name().to_string_lossy().to_ascii_lowercase() != target {
            continue;
        }
        match read_agent_transcripts(&path) {
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
                format!("读取 Cursor 会话失败：{message}"),
            ));
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

/// 读取某个工作区目录下的 `agent-transcripts/<uuid>/<uuid>.jsonl`。
fn read_agent_transcripts(project_dir: &Path) -> Result<Vec<NativeSessionInfo>, AppError> {
    let root = project_dir.join("agent-transcripts");
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&root).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("读取 Cursor 转录目录失败（{}）：{error}", root.display()),
        )
    })?;

    let mut items = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let session_id = entry.file_name().to_string_lossy().to_string();
        if session_id.trim().is_empty() {
            continue;
        }
        let transcript = locate_transcript(&dir, &session_id);
        let Some(transcript) = transcript else {
            continue;
        };
        if let Ok(info) = read_transcript(&transcript, &session_id) {
            items.push(info);
        }
    }
    Ok(items)
}

/// 优先取目录内的 `<会话id>.jsonl`，否则退而取目录内任意 `.jsonl`。
fn locate_transcript(dir: &Path, session_id: &str) -> Option<PathBuf> {
    let named = dir.join(format!("{session_id}.jsonl"));
    if named.is_file() {
        return Some(named);
    }
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| is_jsonl(path))
}

fn is_jsonl(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false)
}

/// 从单个转录文件中提取公开元数据（标识 / 标题 / 起始时间）。
fn read_transcript(path: &Path, session_id: &str) -> Result<NativeSessionInfo, AppError> {
    let file = std::fs::File::open(path).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("无法读取 Cursor 会话转录（{}）：{error}", path.display()),
        )
    })?;
    let reader = std::io::BufReader::new(file);

    let mut title: Option<String> = None;
    let mut created_at: Option<String> = None;

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
        if created_at.is_none() {
            if let Some(text) = first_text(&value) {
                created_at = parse_cursor_timestamp(&text);
            }
        }
        if title.is_none() && value.get("role").and_then(Value::as_str) == Some("user") {
            if let Some(text) = first_text(&value) {
                title = common::sanitize_title(&extract_user_query(&text), TITLE_MAX_CHARS);
            }
        }
        if title.is_some() && created_at.is_some() {
            break;
        }
    }

    Ok(NativeSessionInfo {
        native_id: session_id.to_string(),
        title,
        // 目录编码有损，无法可靠还原真实工作目录 → 不伪造，留空。
        directory: None,
        created_at,
        updated_at: common::file_modified_iso(path),
    })
}

/// 取消息里第一段文本内容（`message.content[].type == "text"`）。
fn first_text(value: &Value) -> Option<String> {
    let content = value.get("message")?.get("content")?.as_array()?;
    content.iter().find_map(|part| {
        if part.get("type").and_then(Value::as_str) == Some("text") {
            part.get("text").and_then(Value::as_str).map(str::to_string)
        } else {
            None
        }
    })
}

/// 若文本包含 `<user_query>...</user_query>` 则取其中内容，否则取全文。
fn extract_user_query(text: &str) -> String {
    const OPEN: &str = "<user_query>";
    const CLOSE: &str = "</user_query>";
    if let Some(start) = text.find(OPEN) {
        let rest = &text[start + OPEN.len()..];
        if let Some(end) = rest.find(CLOSE) {
            return rest[..end].to_string();
        }
        return rest.to_string();
    }
    text.to_string()
}

/// 解析消息中的 `<timestamp>...</timestamp>` 为 RFC3339。
///
/// Cursor 的写法形如 `Friday, Sep 11, 2026, 4:31 PM (UTC+8)`；解析失败返回 `None`。
fn parse_cursor_timestamp(text: &str) -> Option<String> {
    const OPEN: &str = "<timestamp>";
    const CLOSE: &str = "</timestamp>";
    let start = text.find(OPEN)? + OPEN.len();
    let rest = &text[start..];
    let end = rest.find(CLOSE)?;
    let inner = rest[..end].trim();
    let (date_part, offset) = split_offset(inner)?;
    let naive = parse_naive_datetime(date_part)?;
    let datetime = offset.from_local_datetime(&naive).single()?;
    Some(datetime.to_rfc3339())
}

/// 将 `... (UTC+8)` 拆成「日期时间部分」与「时区偏移」。
fn split_offset(text: &str) -> Option<(&str, chrono::FixedOffset)> {
    let open = text.rfind('(')?;
    let close = text.rfind(')')?;
    if close <= open {
        return None;
    }
    let offset = parse_utc_offset(&text[open + 1..close])?;
    let date_part = text[..open].trim().trim_end_matches(',').trim();
    if date_part.is_empty() {
        return None;
    }
    Some((date_part, offset))
}

fn parse_utc_offset(text: &str) -> Option<chrono::FixedOffset> {
    let idx = text.find("UTC")?;
    let mut chars = text[idx + 3..].trim().chars();
    let sign = match chars.next()? {
        '+' => 1,
        '-' => -1,
        _ => return None,
    };
    let digits: String = chars.take_while(|ch| ch.is_ascii_digit()).collect();
    let hours: i32 = digits.parse().ok()?;
    chrono::FixedOffset::east_opt(sign * hours * 3600)
}

fn parse_naive_datetime(text: &str) -> Option<chrono::NaiveDateTime> {
    for format in ["%A, %b %e, %Y, %I:%M %p", "%A, %b %d, %Y, %I:%M %p"] {
        if let Ok(value) = chrono::NaiveDateTime::parse_from_str(text, format) {
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_transcript(projects: &Path, encoded: &str, session_id: &str, lines: &str) -> PathBuf {
        let dir = projects.join(encoded).join("agent-transcripts").join(session_id);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        fs::write(&path, lines).unwrap();
        path
    }

    #[test]
    fn lists_matching_project_and_extracts_title_from_user_query() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let session_id = "54e9f423-9d03-4314-b849-d596b8bb8d4c";
        write_transcript(
            &projects,
            "d-works-waterbill",
            session_id,
            concat!(
                "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<timestamp>Friday, Sep 11, 2026, 4:31 PM (UTC+8)</timestamp>\\n<user_query>\\n修复 布局 问题\\n</user_query>\"}]}}\n",
                "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Glob\",\"input\":{}}]}}\n",
            ),
        );

        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].native_id, session_id);
        assert_eq!(items[0].title.as_deref(), Some("修复 布局 问题"));
        assert!(items[0].created_at.is_some(), "应解析出起始时间");
        assert!(items[0].directory.is_none(), "有损编码不应反推出真实目录");
    }

    #[test]
    fn excludes_other_projects() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        write_transcript(
            &projects,
            "c-users-zzz-desktop-other",
            "11111111-1111-4111-8111-111111111111",
            "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<user_query>别的项目</user_query>\"}]}}\n",
        );

        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty(), "不应混入其它项目的会话");
    }

    #[test]
    fn ignores_numeric_and_transcriptless_dirs() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        fs::create_dir_all(projects.join("d-works-waterbill")).unwrap();
        // 没有 agent-transcripts 的匹配项目：空列表而非报错。
        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn title_is_none_when_only_tool_output() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        write_transcript(
            &projects,
            "d-works-waterbill",
            "22222222-2222-4222-8222-222222222222",
            "{\"role\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Shell\",\"input\":{}}]}}\n",
        );
        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].title.is_none(), "无有效用户消息时标题应为空");
    }

    #[test]
    fn missing_projects_root_is_empty() {
        let root = tempfile::tempdir().unwrap();
        let items = list_in(&root.path().join("nope"), Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn parses_cursor_timestamp_with_offset() {
        let text = "<timestamp>Friday, Sep 11, 2026, 4:31 PM (UTC+8)</timestamp>";
        let parsed = parse_cursor_timestamp(text).unwrap();
        assert_eq!(parsed, "2026-09-11T16:31:00+08:00");
    }
}
