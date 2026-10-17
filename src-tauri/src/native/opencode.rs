//! OpenCode（`opencode`）原生会话适配器。
//!
//! 所有能力均基于 OpenCode 官方公开接口：
//!  - 创建 / 查询 / 改名 / 删除：官方 HTTP 服务（`opencode serve`）；
//!  - 枚举历史：`opencode session list --format json`；
//!  - 恢复：`opencode --session <id>`（由上层启动逻辑使用）。
//!
//! 适配器只读取会话的元数据（标识、标题、目录、时间），绝不读取任何对话内容。
//!
//! # 会话接口的版本差异（HTTP 405 的真实成因）
//!
//! OpenCode 服务存在两套并行的会话 REST 接口：
//!  - **经典接口**：创建 `POST /session`，查询 `GET /session/{id}`、改名
//!    `PATCH /session/{id}`、删除 `DELETE /session/{id}`；创建通过查询参数
//!    `directory` 指定项目目录，响应为**裸** `Session` 对象；
//!  - **v2 接口**：创建 `POST /api/session` 等；创建通过请求体
//!    `{ "location": { "directory": ... } }` 指定目录，响应为
//!    `{ "data": Session }`（`Session` 的目录字段位于 `location.directory`）。
//!
//! 不同版本 / 连接模式（例如仅挂载 v2 接口的构建）可能只注册其中一套。此时对另一套
//! 路径发起请求不会命中任何 API 路由，而是落到服务的前端静态处理器上；该处理器不接受
//! 该方法，于是返回 **HTTP 405 Method Not Allowed**——这既不是路径拼写错误，也不是
//! 「应把 GET 改成 POST」。
//!
//! 因此本适配器在发起请求前，先读取服务自带的 OpenAPI 文档（`GET /doc`）据实选择接口，
//! 而不是盲目轮换路径或方法；文档不可用（网络 / 解析失败）时保守回退到经典接口，以保持
//! 对既有版本的行为不变。

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

/// 会话 REST 接口风格。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionApi {
    /// 经典接口：`/session`。
    Classic,
    /// v2 接口：`/api/session`。
    V2,
}

/// 从服务接口文档解析出的会话接口能力。
#[derive(Debug, Clone, Copy)]
struct SessionRoutes {
    api: SessionApi,
    create: bool,
    get: bool,
    rename: bool,
    delete: bool,
}

impl SessionRoutes {
    /// 保守默认：经典接口（历史版本均提供，且含改名 / 删除）。
    fn classic() -> Self {
        Self {
            api: SessionApi::Classic,
            create: true,
            get: true,
            rename: true,
            delete: true,
        }
    }

    fn base(&self) -> &'static str {
        match self.api {
            SessionApi::Classic => "/session",
            SessionApi::V2 => "/api/session",
        }
    }

    /// 单个会话的资源路径。
    fn session_path(&self, native_id: &str) -> String {
        format!("{}/{}", self.base(), encode_query(native_id))
    }

    /// v2 响应外层包裹 `{ "data": ... }`。
    fn wraps_data(&self) -> bool {
        self.api == SessionApi::V2
    }
}

/// 读取服务接口文档，解析出可用的会话接口。
///
/// 返回 `Ok(Some)` 表示已确定接口；`Ok(None)` 表示文档可用但未提供任何会话创建接口；
/// `Err` 表示文档不可读取 / 无法解析（调用方据此保守回退）。
fn discover_routes(port: u16) -> Result<Option<SessionRoutes>, AppError> {
    let response = http::request("127.0.0.1", port, "GET", "/doc", None)?;
    if !(200..300).contains(&response.status) {
        return Err(AppError::new(
            "NATIVE_API_DISCOVERY",
            format!("读取 OpenCode 接口文档失败（HTTP {}）。", response.status),
        ));
    }
    let doc: Value = serde_json::from_str(&response.body).map_err(|error| {
        AppError::new(
            "NATIVE_API_DISCOVERY",
            format!("OpenCode 接口文档无法解析：{error}"),
        )
    })?;
    let Some(paths) = doc.get("paths").and_then(Value::as_object) else {
        return Err(AppError::new(
            "NATIVE_API_DISCOVERY",
            "OpenCode 接口文档缺少 paths，无法确认会话接口。",
        ));
    };
    let has = |path: &str, method: &str| {
        paths
            .get(path)
            .and_then(Value::as_object)
            .map(|operations| operations.contains_key(method))
            .unwrap_or(false)
    };

    // 经典接口完整（含改名 / 删除），优先使用。
    let classic = SessionRoutes {
        api: SessionApi::Classic,
        create: has("/session", "post"),
        get: has("/session/{sessionID}", "get"),
        rename: has("/session/{sessionID}", "patch"),
        delete: has("/session/{sessionID}", "delete"),
    };
    if classic.create {
        return Ok(Some(classic));
    }

    let v2 = SessionRoutes {
        api: SessionApi::V2,
        create: has("/api/session", "post"),
        get: has("/api/session/{sessionID}", "get"),
        rename: has("/api/session/{sessionID}", "patch"),
        delete: has("/api/session/{sessionID}", "delete"),
    };
    if v2.create {
        return Ok(Some(v2));
    }

    Ok(None)
}

/// 解析本次要使用的会话接口：文档可用则据实选择，否则保守回退经典接口。
fn resolve_routes(port: u16) -> Result<SessionRoutes, AppError> {
    match discover_routes(port) {
        Ok(Some(routes)) => Ok(routes),
        Ok(None) => Err(AppError::new(
            "NATIVE_API_UNSUPPORTED",
            "当前 OpenCode 服务未提供可用的会话接口（已检查 /session 与 /api/session）。该版本或连接模式的接口路径可能不同。",
        )),
        Err(_) => Ok(SessionRoutes::classic()),
    }
}

/// 在项目目录下创建一个原生会话。
pub fn create(ctx: &ToolContext, title: Option<&str>) -> Result<NativeSessionInfo, AppError> {
    with_server(ctx, |port| {
        create_at(port, &ctx.working_dir.to_string_lossy(), title)
    })
}

fn create_at(port: u16, working_dir: &str, title: Option<&str>) -> Result<NativeSessionInfo, AppError> {
    let routes = resolve_routes(port)?;
    if !routes.create {
        return Err(AppError::new(
            "NATIVE_API_UNSUPPORTED",
            "当前 OpenCode 服务未提供会话创建接口。",
        ));
    }

    let (path, body) = match routes.api {
        SessionApi::Classic => (
            format!("/session?directory={}", encode_query(working_dir)),
            title_body(title),
        ),
        // v2 的请求体不接受 title，且需显式给出目录位置。
        SessionApi::V2 => (
            "/api/session".to_string(),
            serde_json::json!({ "location": { "directory": working_dir } }).to_string(),
        ),
    };

    let response = http::request("127.0.0.1", port, "POST", &path, Some(&body))?;
    if !(200..300).contains(&response.status) {
        return Err(http_failure(
            "NATIVE_CREATE_FAILED",
            "创建原生会话",
            "POST",
            &path,
            &response,
        ));
    }
    let value = parse_json(&response.body, "原生会话")?;
    let value = unwrap_data(routes, value);
    parse_info(&value).ok_or_else(|| AppError::new("NATIVE_RESPONSE", "原生会话响应缺少标识字段。"))
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
            if directory_matches(&ctx.working_dir.to_string_lossy(), info.directory.as_deref()) {
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
        get_at(port, &ctx.working_dir.to_string_lossy(), native_id)
    })
}

fn get_at(
    port: u16,
    working_dir: &str,
    native_id: &str,
) -> Result<Option<NativeSessionInfo>, AppError> {
    let routes = resolve_routes(port)?;
    if !routes.get {
        return Err(AppError::new(
            "NATIVE_API_UNSUPPORTED",
            "当前 OpenCode 服务未提供会话查询接口。",
        ));
    }
    let path = routes.session_path(native_id);
    let response = http::request("127.0.0.1", port, "GET", &path, None)?;
    if response.status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&response.status) {
        return Err(http_failure(
            "NATIVE_GET_FAILED",
            "查询原生会话",
            "GET",
            &path,
            &response,
        ));
    }
    let value = parse_json(&response.body, "原生会话")?;
    let value = unwrap_data(routes, value);
    Ok(match parse_info(&value) {
        Some(info) if directory_matches(working_dir, info.directory.as_deref()) => Some(info),
        _ => None,
    })
}

/// 修改原生会话标题（仅标题，不触碰任何对话内容）。
pub fn rename_title(ctx: &ToolContext, native_id: &str, title: &str) -> Result<(), AppError> {
    with_server(ctx, |port| rename_at(port, native_id, title))
}

fn rename_at(port: u16, native_id: &str, title: &str) -> Result<(), AppError> {
    let routes = resolve_routes(port)?;
    if !routes.rename {
        return Err(AppError::new(
            "NATIVE_API_UNSUPPORTED",
            "当前 OpenCode 服务未提供修改会话标题接口。",
        ));
    }
    let path = routes.session_path(native_id);
    let body = serde_json::json!({ "title": title }).to_string();
    let response = http::request("127.0.0.1", port, "PATCH", &path, Some(&body))?;
    if !(200..300).contains(&response.status) {
        return Err(http_failure(
            "NATIVE_RENAME_FAILED",
            "修改原生会话标题",
            "PATCH",
            &path,
            &response,
        ));
    }
    Ok(())
}

/// 删除原生会话。仅用于补偿「会话已创建但未能保存关联」的回滚场景。
pub fn delete(ctx: &ToolContext, native_id: &str) -> Result<(), AppError> {
    with_server(ctx, |port| delete_at(port, native_id))
}

fn delete_at(port: u16, native_id: &str) -> Result<(), AppError> {
    let routes = resolve_routes(port)?;
    if !routes.delete {
        return Err(AppError::new(
            "NATIVE_API_UNSUPPORTED",
            "当前 OpenCode 服务未提供删除会话接口。",
        ));
    }
    let path = routes.session_path(native_id);
    let response = http::request("127.0.0.1", port, "DELETE", &path, None)?;
    if response.status == 404 {
        return Ok(());
    }
    if !(200..300).contains(&response.status) {
        return Err(http_failure(
            "NATIVE_DELETE_FAILED",
            "删除原生会话",
            "DELETE",
            &path,
            &response,
        ));
    }
    Ok(())
}

/// 创建后首次进入新会话所需的启动参数。
pub fn create_launch_args(native_id: &str) -> Vec<String> {
    vec!["--session".to_string(), native_id.to_string()]
}

/// 恢复既有会话所需的启动参数。
pub fn restore_launch_args(native_id: &str) -> Vec<String> {
    vec!["--session".to_string(), native_id.to_string()]
}

fn title_body(title: Option<&str>) -> String {
    match title.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => serde_json::json!({ "title": value }).to_string(),
        None => "{}".to_string(),
    }
}

fn parse_json(body: &str, what: &str) -> Result<Value, AppError> {
    serde_json::from_str(body)
        .map_err(|error| AppError::new("NATIVE_RESPONSE", format!("无法解析{what}响应：{error}")))
}

/// v2 接口把结果包裹在 `{ "data": ... }` 中；经典接口则为裸对象。
fn unwrap_data(routes: SessionRoutes, value: Value) -> Value {
    if routes.wraps_data() {
        if let Some(data) = value.get("data") {
            return data.clone();
        }
    }
    value
}

/// 构造包含服务端诊断信息的 HTTP 失败错误（保留状态码、请求方法/路径、`Allow` 头与响应正文）。
fn http_failure(
    code: &str,
    action: &str,
    method: &str,
    path: &str,
    response: &http::HttpResponse,
) -> AppError {
    let mut message = format!("{action}失败（HTTP {}，请求 {method} {path}）。", response.status);
    if let Some(allow) = response.header("Allow") {
        message.push_str(&format!("服务允许的方法：{allow}。"));
    }
    let detail = sanitize_detail(&response.body);
    if !detail.is_empty() {
        message.push_str(&format!("服务响应：{detail}"));
    }
    AppError::new(code, message)
}

/// 将服务响应正文压缩为单行、去除控制字符并限长，避免泄漏无关内容或撑爆提示。
fn sanitize_detail(body: &str) -> String {
    let flattened = body
        .chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect::<String>();
    let collapsed = flattened.split_whitespace().collect::<Vec<_>>().join(" ");
    const LIMIT: usize = 300;
    if collapsed.chars().count() > LIMIT {
        let truncated: String = collapsed.chars().take(LIMIT).collect();
        return format!("{truncated}…");
    }
    collapsed
}

/// 从 OpenCode 的会话对象中解析公开元数据。
///
/// 兼容三种字段布局：经典 HTTP 服务的顶层 `directory`、v2 服务的
/// `location.directory`，以及 CLI `session list --format json` 的顶层
/// `created` / `updated`（毫秒时间戳）。
fn parse_info(value: &Value) -> Option<NativeSessionInfo> {
    let native_id = value.get("id")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string);
    let directory = value
        .get("directory")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("location")
                .and_then(|location| location.get("directory"))
                .and_then(Value::as_str)
        })
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
fn directory_matches(working_dir: &str, directory: Option<&str>) -> bool {
    let Some(directory) = directory else {
        return true;
    };
    normalize_path(directory) == normalize_path(working_dir)
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
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// 一次被记录的请求。
    #[derive(Clone)]
    struct Recorded {
        method: String,
        path: String,
        body: String,
    }

    type Handler = Box<dyn Fn(&str, &str, &str) -> (u16, Vec<(String, String)>, String) + Send + Sync>;

    /// 极简 mock HTTP 服务：按处理器返回响应，并记录收到的请求。
    struct MockServer {
        port: u16,
        records: Arc<Mutex<Vec<Recorded>>>,
    }

    impl MockServer {
        fn start<F>(handler: F) -> Self
        where
            F: Fn(&str, &str, &str) -> (u16, Vec<(String, String)>, String) + Send + Sync + 'static,
        {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let records = Arc::new(Mutex::new(Vec::new()));
            let sink = records.clone();
            let handler: Arc<Handler> = Arc::new(Box::new(handler));
            thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let Ok((method, path, body)) = read_request(&stream) else {
                        continue;
                    };
                    sink.lock().unwrap().push(Recorded {
                        method: method.clone(),
                        path: path.clone(),
                        body: body.clone(),
                    });
                    let (status, headers, response_body) = handler(&method, &path, &body);
                    let _ = write_response(stream, status, &headers, &response_body);
                }
            });
            MockServer { port, records }
        }

        fn last(&self) -> Recorded {
            self.records
                .lock()
                .unwrap()
                .last()
                .cloned()
                .expect("没有记录到请求")
        }
    }

    fn read_request(stream: &TcpStream) -> std::io::Result<(String, String, String)> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut request_line = String::new();
        reader.read_line(&mut request_line)?;
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        let mut content_length = 0usize;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.trim().eq_ignore_ascii_case("content-length") {
                    content_length = value.trim().parse().unwrap_or(0);
                }
            }
        }
        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            reader.read_exact(&mut body)?;
        }
        Ok((method, path, String::from_utf8_lossy(&body).into_owned()))
    }

    fn write_response(
        mut stream: TcpStream,
        status: u16,
        headers: &[(String, String)],
        body: &str,
    ) -> std::io::Result<()> {
        let reason = match status {
            200 => "OK",
            404 => "Not Found",
            405 => "Method Not Allowed",
            _ => "Status",
        };
        let mut out = format!("HTTP/1.1 {status} {reason}\r\n");
        for (name, value) in headers {
            out.push_str(&format!("{name}: {value}\r\n"));
        }
        out.push_str("Content-Type: application/json\r\n");
        out.push_str(&format!("Content-Length: {}\r\n", body.len()));
        out.push_str("Connection: close\r\n\r\n");
        out.push_str(body);
        stream.write_all(out.as_bytes())?;
        stream.flush()
    }

    fn doc_with(paths: Value) -> String {
        serde_json::json!({ "paths": paths }).to_string()
    }

    fn classic_doc() -> String {
        doc_with(serde_json::json!({
            "/session": { "get": {}, "post": {} },
            "/session/{sessionID}": { "get": {}, "patch": {}, "delete": {} },
        }))
    }

    #[test]
    fn create_uses_classic_route_and_query_when_doc_advertises_it() {
        let doc = classic_doc();
        let server = MockServer::start(move |method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (200, vec![], doc.clone());
            }
            if method == "POST" && path.starts_with("/session?directory=") {
                return (
                    200,
                    vec![],
                    r#"{"id":"ses_classic","title":"标题","directory":"C:\\proj","time":{"created":1,"updated":2}}"#
                        .to_string(),
                );
            }
            (500, vec![], "unexpected".to_string())
        });

        let info = create_at(server.port, r"C:\proj", Some("标题")).unwrap();
        assert_eq!(info.native_id, "ses_classic");

        let request = server.last();
        assert_eq!(request.method, "POST");
        assert!(
            request.path.starts_with("/session?directory=C%3A%5Cproj"),
            "经典接口应按查询参数指定目录：{}",
            request.path
        );
        assert!(request.body.contains("标题"), "标题应写入请求体：{}", request.body);
    }

    #[test]
    fn create_uses_v2_route_when_only_api_surface_is_advertised() {
        // 该服务的接口文档只提供 v2 接口：此前对 /session 的请求会落到静态处理器并返回 405。
        let doc = doc_with(serde_json::json!({ "/api/session": { "post": {} } }));
        let server = MockServer::start(move |method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (200, vec![], doc.clone());
            }
            if method == "POST" && path == "/api/session" {
                return (
                    200,
                    vec![],
                    r#"{"data":{"id":"ses_v2","title":"t","location":{"directory":"C:\\proj"},"time":{"created":1,"updated":2}}}"#
                        .to_string(),
                );
            }
            (405, vec![("Allow".to_string(), "GET".to_string())], "nope".to_string())
        });

        let info = create_at(server.port, r"C:\proj", None).unwrap();
        assert_eq!(info.native_id, "ses_v2");
        assert_eq!(info.directory.as_deref(), Some(r"C:\proj"));
        assert_eq!(server.last().path, "/api/session");
    }

    #[test]
    fn create_reports_405_details_without_faking_success() {
        let doc = classic_doc();
        let server = MockServer::start(move |method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (200, vec![], doc.clone());
            }
            (
                405,
                vec![("Allow".to_string(), "GET".to_string())],
                r#"{"message":"Method Not Allowed"}"#.to_string(),
            )
        });

        let error = create_at(server.port, r"C:\proj", None).unwrap_err();
        assert_eq!(error.code, "NATIVE_CREATE_FAILED");
        assert!(error.message.contains("405"), "{}", error.message);
        assert!(error.message.contains("POST /session"), "{}", error.message);
        assert!(
            error.message.contains("Method Not Allowed"),
            "应保留服务响应正文：{}",
            error.message
        );
        assert!(error.message.contains("Allow"), "应保留 Allow 头：{}", error.message);
    }

    #[test]
    fn create_falls_back_to_classic_when_doc_is_unavailable() {
        let server = MockServer::start(|method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (404, vec![], String::new());
            }
            if method == "POST" && path.starts_with("/session?directory=") {
                return (
                    200,
                    vec![],
                    r#"{"id":"ses_fallback","title":null,"directory":"C:\\proj","time":{"created":1,"updated":2}}"#
                        .to_string(),
                );
            }
            (500, vec![], "unexpected".to_string())
        });

        let info = create_at(server.port, r"C:\proj", None).unwrap();
        assert_eq!(info.native_id, "ses_fallback");
    }

    #[test]
    fn create_reports_unsupported_when_doc_lists_no_create_route() {
        let doc = doc_with(serde_json::json!({ "/session": { "get": {} } }));
        let server = MockServer::start(move |method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (200, vec![], doc.clone());
            }
            (200, vec![], "{}".to_string())
        });

        let error = create_at(server.port, r"C:\proj", None).unwrap_err();
        assert_eq!(error.code, "NATIVE_API_UNSUPPORTED");
    }

    #[test]
    fn get_rename_delete_follow_resolved_classic_base() {
        let doc = classic_doc();
        let server = MockServer::start(move |method, path, _body| {
            if method == "GET" && path == "/doc" {
                return (200, vec![], doc.clone());
            }
            if method == "GET" && path == "/session/ses_x" {
                return (
                    200,
                    vec![],
                    r#"{"id":"ses_x","title":"t","directory":"C:\\proj","time":{"created":1,"updated":2}}"#
                        .to_string(),
                );
            }
            if method == "PATCH" && path == "/session/ses_x" {
                return (200, vec![], "{}".to_string());
            }
            if method == "DELETE" && path == "/session/ses_x" {
                return (200, vec![], "true".to_string());
            }
            (500, vec![], "unexpected".to_string())
        });

        assert!(get_at(server.port, r"C:\proj", "ses_x").unwrap().is_some());
        assert!(rename_at(server.port, "ses_x", "新标题").is_ok());
        assert!(delete_at(server.port, "ses_x").is_ok());
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
    fn parses_v2_location_shape() {
        let value: Value = serde_json::from_str(
            r#"{"id":"ses_v2","title":"t","location":{"directory":"C:\\proj"},
                "time":{"created":1700000000000,"updated":1700000002000}}"#,
        )
        .unwrap();
        let info = parse_info(&value).unwrap();
        assert_eq!(info.native_id, "ses_v2");
        assert_eq!(info.directory.as_deref(), Some(r"C:\proj"));
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
        let ctx_dir = r"C:\Work\Proj";
        assert!(directory_matches(ctx_dir, Some("c:/work/proj")));
        assert!(directory_matches(ctx_dir, Some(r"C:\Work\Proj\")));
        assert!(!directory_matches(ctx_dir, Some(r"C:\Other")));
        assert!(directory_matches(ctx_dir, None));
    }

    #[test]
    fn encodes_query_parameters() {
        assert_eq!(encode_query(r"C:\my project"), "C%3A%5Cmy%20project");
    }

    #[test]
    fn sanitize_detail_collapses_and_limits() {
        assert_eq!(sanitize_detail("a\r\n\tb  c"), "a b c");
        let long = "x".repeat(400);
        assert!(sanitize_detail(&long).chars().count() <= 301);
    }
}
