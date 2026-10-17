//! OpenCode（`opencode`）原生会话适配器。
//!
//! 所有能力均基于 OpenCode 官方公开接口，且已在 1.19.0 本机核实：
//!  - 创建 / 查询 / 改名 / 删除：官方 HTTP 服务（`opencode serve`）；
//!  - 枚举历史：`opencode session list --format json`；
//!  - 恢复：`opencode --session <id>`（由上层启动逻辑使用）。
//!
//! 适配器只读取会话的元数据（标识、标题、目录、时间），绝不读取任何对话内容。

use crate::error::AppError;
use serde_json::Value;
use std::time::Duration;

use super::history::HistoryListing;
use super::server;
use super::{http, proc, NativeSessionInfo, ToolContext};

/// 枚举历史会话的超时时间。
const LIST_TIMEOUT: Duration = Duration::from_secs(25);

/// 在临时服务上执行一段操作，结束后可靠终止服务。
fn with_server<T>(
    ctx: &ToolContext,
    run: impl FnOnce(u16) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut serve = server::start(&ctx.executable, &ctx.working_dir)?;
    let outcome = run(serve.port);
    serve.terminate();
    outcome
}

/// 在项目目录下创建一个原生会话。
pub fn create(ctx: &ToolContext, title: Option<&str>) -> Result<NativeSessionInfo, AppError> {
    with_server(ctx, |port| {
        let path = format!(
            "/session?directory={}",
            encode_query(&ctx.working_dir.to_string_lossy())
        );
        let body = match title.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => serde_json::json!({ "title": value }).to_string(),
            None => "{}".to_string(),
        };
        let response = http::request("127.0.0.1", port, "POST", &path, Some(&body))?;
        if !(200..300).contains(&response.status) {
            return Err(AppError::new(
                "NATIVE_CREATE_FAILED",
                format!("创建原生会话失败（HTTP {}）。", response.status),
            ));
        }
        let value: Value = serde_json::from_str(&response.body).map_err(|error| {
            AppError::new("NATIVE_RESPONSE", format!("无法解析原生会话响应：{error}"))
        })?;
        parse_info(&value)
            .ok_or_else(|| AppError::new("NATIVE_RESPONSE", "原生会话响应缺少标识字段。"))
    })
}

/// 枚举当前项目目录下的历史会话（按更新时间倒序）。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let args = vec![
        "session".to_string(),
        "list".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ];
    let output = proc::run_capture(&ctx.executable, &args, &ctx.working_dir, LIST_TIMEOUT)?;
    if output.code != Some(0) {
        let detail = output.stderr.trim();
        let detail = if detail.is_empty() {
            "命令未正常结束。"
        } else {
            detail
        };
        return Err(AppError::new(
            "NATIVE_LIST_FAILED",
            format!("读取原生会话列表失败：{detail}"),
        ));
    }

    let trimmed = output.stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|error| {
        AppError::new("NATIVE_RESPONSE", format!("无法解析原生会话列表：{error}"))
    })?;
    let array = value
        .as_array()
        .ok_or_else(|| AppError::new("NATIVE_RESPONSE", "原生会话列表格式异常。"))?;

    let mut items = Vec::new();
    for entry in array {
        if let Some(info) = parse_info(entry) {
            if directory_matches(ctx, info.directory.as_deref()) {
                items.push(info);
            }
        }
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

/// 带来源状态的枚举：OpenCode 通过 CLI / 服务读取，失败即视为「无法读取」。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    match list(ctx) {
        Ok(items) => Ok(HistoryListing::available(items)),
        Err(_) => Ok(HistoryListing::unreadable()),
    }
}

/// 查询单个原生会话；不存在或不属于当前项目目录时返回 `None`。
pub fn get(ctx: &ToolContext, native_id: &str) -> Result<Option<NativeSessionInfo>, AppError> {
    with_server(ctx, |port| {
        let path = format!("/session/{}", encode_query(native_id));
        let response = http::request("127.0.0.1", port, "GET", &path, None)?;
        if response.status == 404 {
            return Ok(None);
        }
        if !(200..300).contains(&response.status) {
            return Err(AppError::new(
                "NATIVE_GET_FAILED",
                format!("查询原生会话失败（HTTP {}）。", response.status),
            ));
        }
        let value: Value = serde_json::from_str(&response.body).map_err(|error| {
            AppError::new("NATIVE_RESPONSE", format!("无法解析原生会话响应：{error}"))
        })?;
        Ok(match parse_info(&value) {
            Some(info) if directory_matches(ctx, info.directory.as_deref()) => Some(info),
            _ => None,
        })
    })
}

/// 修改原生会话标题（仅标题，不触碰任何对话内容）。
pub fn rename_title(ctx: &ToolContext, native_id: &str, title: &str) -> Result<(), AppError> {
    with_server(ctx, |port| {
        let path = format!("/session/{}", encode_query(native_id));
        let body = serde_json::json!({ "title": title }).to_string();
        let response = http::request("127.0.0.1", port, "PATCH", &path, Some(&body))?;
        if !(200..300).contains(&response.status) {
            return Err(AppError::new(
                "NATIVE_RENAME_FAILED",
                format!("修改原生会话标题失败（HTTP {}）。", response.status),
            ));
        }
        Ok(())
    })
}

/// 删除原生会话。仅用于补偿「会话已创建但未能保存关联」的回滚场景。
pub fn delete(ctx: &ToolContext, native_id: &str) -> Result<(), AppError> {
    with_server(ctx, |port| {
        let path = format!("/session/{}", encode_query(native_id));
        let response = http::request("127.0.0.1", port, "DELETE", &path, None)?;
        if response.status == 404 {
            return Ok(());
        }
        if !(200..300).contains(&response.status) {
            return Err(AppError::new(
                "NATIVE_DELETE_FAILED",
                format!("删除原生会话失败（HTTP {}）。", response.status),
            ));
        }
        Ok(())
    })
}

/// 创建后首次进入新会话所需的启动参数。
pub fn create_launch_args(native_id: &str) -> Vec<String> {
    vec!["--session".to_string(), native_id.to_string()]
}

/// 恢复既有会话所需的启动参数。
pub fn restore_launch_args(native_id: &str) -> Vec<String> {
    vec!["--session".to_string(), native_id.to_string()]
}

/// 从 OpenCode 的会话对象中解析公开元数据。
///
/// 兼容两种字段布局：HTTP 服务用 `time.created` / `time.updated`，
/// CLI `session list` 用顶层 `created` / `updated`（毫秒时间戳）。
fn parse_info(value: &Value) -> Option<NativeSessionInfo> {
    let native_id = value.get("id")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);
    let directory = value
        .get("directory")
        .and_then(Value::as_str)
        .map(str::to_string);
    let (created, updated) = match value.get("time") {
        Some(time) => (
            time.get("created").and_then(Value::as_i64),
            time.get("updated").and_then(Value::as_i64),
        ),
        None => (
            value.get("created").and_then(Value::as_i64),
            value.get("updated").and_then(Value::as_i64),
        ),
    };
    Some(NativeSessionInfo {
        native_id,
        title,
        directory,
        created_at: created.and_then(ms_to_iso),
        updated_at: updated.and_then(ms_to_iso),
    })
}

fn ms_to_iso(ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms).map(|value| value.to_rfc3339())
}

/// 会话目录是否与目标项目目录一致（大小写与分隔符不敏感）。
fn directory_matches(ctx: &ToolContext, directory: Option<&str>) -> bool {
    let Some(directory) = directory else {
        return true;
    };
    normalize_path(directory) == normalize_path(&ctx.working_dir.to_string_lossy())
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// 对查询串 / 路径片段做百分号编码。
fn encode_query(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(working_dir: &str) -> ToolContext {
        ToolContext {
            tool_id: "opencode".to_string(),
            tool_name: "OpenCode".to_string(),
            executable: std::path::PathBuf::from("opencode.exe"),
            working_dir: std::path::PathBuf::from(working_dir),
        }
    }

    #[test]
    fn parses_http_session_shape() {
        let value: Value = serde_json::from_str(
            r#"{"id":"ses_abc","title":"标题","directory":"C:\\proj",
                "time":{"created":1700000000000,"updated":1700000001000}}"#,
        )
        .unwrap();
        let info = parse_info(&value).unwrap();
        assert_eq!(info.native_id, "ses_abc");
        assert_eq!(info.title.as_deref(), Some("标题"));
        assert!(info.created_at.is_some());
        assert!(info.updated_at.is_some());
    }

    #[test]
    fn parses_cli_list_shape() {
        let value: Value = serde_json::from_str(
            r#"{"id":"ses_x","title":"t","directory":"C:/proj",
                "created":1700000000000,"updated":1700000002000}"#,
        )
        .unwrap();
        let info = parse_info(&value).unwrap();
        assert_eq!(info.native_id, "ses_x");
        assert!(info.updated_at.is_some());
    }

    #[test]
    fn directory_match_ignores_case_and_separators() {
        let ctx = context(r"C:\Work\Proj");
        assert!(directory_matches(&ctx, Some("c:/work/proj")));
        assert!(directory_matches(&ctx, Some(r"C:\Work\Proj\")));
        assert!(!directory_matches(&ctx, Some(r"C:\Other")));
        assert!(directory_matches(&ctx, None));
    }

    #[test]
    fn encodes_query_parameters() {
        assert_eq!(
            encode_query(r"C:\my project"),
            "C%3A%5Cmy%20project"
        );
    }
}
