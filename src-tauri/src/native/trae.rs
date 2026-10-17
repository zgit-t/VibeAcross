//! Trae 桌面应用的原生会话**只读**适配器（仅 Trae CN 来源；TRAE SOLO 见 [`super::trae_solo`]）。
//!
//! 能力依据：Trae 为桌面 IDE（本机已确认其 `trae-cn.cmd` 只是 VS Code 风格的目录 /
//! 文件打开器，没有创建 / 恢复 AI 会话的命令行接口），因此**不提供**创建 / 恢复 /
//! 改名 / 删除。
//!
//! 数据来源为 **Trae CN**（`%USERPROFILE%\.trae-cn`）：本地仅落盘**会话记忆摘要**，位于
//!   ```text
//!   ~/.trae-cn/memory/projects/<项目编码>/<日期>/session_memory_<会话id>.jsonl
//!   ```
//! 每个 `session_memory_<会话id>.jsonl` 对应一个稳定会话标识（同一会话在多个日期目录
//! 中是**同一会话的每日快照**，会去重取最新）。标题取其中可靠的 `intent` 字段。
//! 该来源**不含**完整转录，也无法据此恢复会话——如实标注为限制。
//!
//! 独立的 TRAE SOLO 应用使用另一套数据来源，由 [`super::trae_solo`] 单独处理，二者
//! 绝不混淆。

use serde_json::Value;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

use crate::error::AppError;

use super::common;
use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 读取会话记忆文件以提取 `intent` 时最多读取的行数。
const MAX_SCAN_LINES: usize = 50;

/// 生成标题时的最大字符数。
const TITLE_MAX_CHARS: usize = 80;

/// 枚举当前项目目录下的 Trae CN 历史会话（按更新时间倒序）。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let home = common::user_home().ok_or_else(|| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            "无法确定用户主目录，无法定位 Trae CN 的本地会话目录。",
        )
    })?;
    let root = home.join(".trae-cn").join("memory").join("projects");
    list_in(&root, &ctx.working_dir)
}

/// 带来源状态的枚举：根目录不存在 → 来源缺失；读取失败 → 无法读取。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let Some(home) = common::user_home() else {
        return Ok(HistoryListing::unreadable());
    };
    let root = home.join(".trae-cn").join("memory").join("projects");
    if !root.is_dir() {
        return Ok(HistoryListing::source_missing());
    }
    match list_in(&root, &ctx.working_dir) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 从给定 `memory/projects` 根目录枚举归属 `working_dir` 的会话（便于受控测试）。
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
            format!("读取 Trae 会话目录失败（{}）：{error}", projects.display()),
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
        let Some(encoded) = decode_project_dir(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        if encoded != target {
            continue;
        }
        match collect_project_sessions(&path) {
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
                format!("读取 Trae 会话失败：{message}"),
            ));
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

/// 一个项目的日期目录 → 会话快照：同一会话取最新日期的一份。
fn collect_project_sessions(project_dir: &Path) -> Result<Vec<NativeSessionInfo>, AppError> {
    let mut best: HashMap<String, (String, PathBuf)> = HashMap::new();
    let date_dirs = std::fs::read_dir(project_dir).map_err(|error| {
        AppError::new(
            "NATIVE_LIST_FAILED",
            format!("读取 Trae 项目目录失败（{}）：{error}", project_dir.display()),
        )
    })?;

    for date_entry in date_dirs.flatten() {
        let date_dir = date_entry.path();
        if !date_dir.is_dir() {
            continue;
        }
        let date = date_entry.file_name().to_string_lossy().to_string();
        let Ok(files) = std::fs::read_dir(&date_dir) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            let Some(session_id) = session_id_from_file(&file.file_name().to_string_lossy()) else {
                continue;
            };
            match best.get(&session_id) {
                Some((current, _)) if *current >= date => {}
                _ => {
                    best.insert(session_id, (date.clone(), path));
                }
            }
        }
    }

    let mut items = Vec::with_capacity(best.len());
    for (session_id, (_, path)) in best {
        items.push(NativeSessionInfo {
            native_id: session_id,
            title: read_intent(&path),
            // 目录编码有损，无法可靠还原真实工作目录 → 不伪造，留空。
            directory: None,
            created_at: None,
            updated_at: common::file_modified_iso(&path),
        });
    }
    Ok(items)
}

/// 从项目目录名解出（有损的）工作区编码：去掉尾部的 `-p2-<哈希>`，再规范为小写编码。
///
/// 例：`-d-works-waterbill--p2-c2ba...` → `d-works-waterbill`。
fn decode_project_dir(name: &str) -> Option<String> {
    let base = match name.rfind("-p2-") {
        Some(index) => {
            let suffix = &name[index + 4..];
            if !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_hexdigit()) {
                &name[..index]
            } else {
                name
            }
        }
        None => name,
    };
    let trimmed = base.trim_matches('-');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_ascii_lowercase())
    }
}

/// 从 `session_memory_<会话id>.jsonl` 文件名解出会话标识。
fn session_id_from_file(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".jsonl")?;
    let id = stem.strip_prefix("session_memory_")?;
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// 读取会话记忆文件中的 `intent` 字段作为候选标题（只读首若干行）。
fn read_intent(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
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
        if let Some(intent) = value.get("intent").and_then(Value::as_str) {
            if let Some(title) = common::sanitize_title(intent, TITLE_MAX_CHARS) {
                return Some(title);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_memory(projects: &Path, project: &str, date: &str, session_id: &str, intent: &str) {
        let dir = projects.join(project).join(date);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("session_memory_{session_id}.jsonl")),
            format!("{{\"intent\":\"{intent}\",\"message_summary_time\":\"2026-09-12 23:48:22\"}}\n"),
        )
        .unwrap();
    }

    #[test]
    fn decode_strips_p2_hash_and_leading_dashes() {
        assert_eq!(
            decode_project_dir("-d-works-waterbill--p2-c2ba3c6f610cd3daa222").as_deref(),
            Some("d-works-waterbill")
        );
        assert_eq!(
            decode_project_dir("-c-Users-ZZZ-Desktop-word--p2-cd54a95a899e636f2a8f").as_deref(),
            Some("c-users-zzz-desktop-word")
        );
    }

    #[test]
    fn lists_and_dedupes_across_date_snapshots_using_latest() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        let project = "-d-works-waterbill--p2-c2ba3c6f610cd3daa222";
        write_memory(&projects, project, "20260912", "6aa56e888da7dafd921e981b", "旧标题");
        write_memory(&projects, project, "20260920", "6aa56e888da7dafd921e981b", "最新标题");
        write_memory(&projects, project, "20260916", "6aaa4df3d0c4a94c1a79fe93", "另一会话");

        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert_eq!(items.len(), 2, "同一会话的多个日期快照应去重");
        let water = items
            .iter()
            .find(|item| item.native_id == "6aa56e888da7dafd921e981b")
            .unwrap();
        assert_eq!(water.title.as_deref(), Some("最新标题"));
    }

    #[test]
    fn excludes_other_projects() {
        let root = tempfile::tempdir().unwrap();
        let projects = root.path().join("projects");
        write_memory(
            &projects,
            "-d-works-world-time--p2-784bdc865bf7318604b6",
            "20260916",
            "6aaa9af4198f32bfb5e8e36e",
            "别的项目",
        );
        let items = list_in(&projects, Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn missing_root_is_empty() {
        let root = tempfile::tempdir().unwrap();
        let items = list_in(&root.path().join("nope"), Path::new(r"D:\works\waterbill")).unwrap();
        assert!(items.is_empty());
    }
}
