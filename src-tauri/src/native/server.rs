//! 本机原生会话服务的生命周期管理。
//!
//! 目前只用于 OpenCode：通过 `opencode serve --port <P> --hostname 127.0.0.1`
//! 在回环地址上临时起一个官方 HTTP 服务，用完后可靠终止。
//!
//! 关键事实：
//!  - 端口通过 `bind(127.0.0.1:0)` 动态分配，避免固定端口冲突；
//!  - 就绪探测使用 `GET /global/health`（该端点无需认证）；
//!  - **OpenCode v2 默认启用 HTTP Basic 认证**：用户名固定为 `opencode`，口令由
//!    服务生成并在启动时以 `server password <口令>` 打印到标准输出。本模块既主动
//!    通过 `OPENCODE_SERVER_PASSWORD` 指定口令，也解析该输出来获取服务真实生效的口令，
//!    供上层对 `/api/*` 请求附带认证；经典版本不使用认证，附带认证头对其无副作用；
//!  - 服务的 `dispose` 端点不会真正退出进程，因此终止必须依赖
//!    `taskkill /PID <pid> /T /F` 杀掉整个进程树。

use crate::error::AppError;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{diagnostics, http, proc};

/// 服务启动的最长等待时间。
const START_TIMEOUT: Duration = Duration::from_secs(25);
/// 轮询就绪的间隔。
const POLL_INTERVAL: Duration = Duration::from_millis(250);
/// 就绪后等待服务打印口令的最长时间（口令通常在就绪前已打印，故保持较短）。
const PASSWORD_GRACE: Duration = Duration::from_millis(400);

/// 一个正在运行的本机服务句柄。
pub struct ServeHandle {
    child: Child,
    pid: u32,
    pub port: u16,
    /// 生效的 HTTP Basic 认证口令（经典版本可能为 `None`，但本实现通常会主动指定）。
    pub password: Option<String>,
}


impl ServeHandle {
    /// 可靠终止服务及其子进程树。
    pub fn terminate(&mut self) {
        diagnostics::log(&format!("终止服务：pid={}", self.pid));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut kill = Command::new("taskkill");
            kill.args(["/PID", &self.pid.to_string(), "/T", "/F"]);
            kill.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            kill.creation_flags(proc::CREATE_NO_WINDOW);
            let _ = kill.status();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 分配一个当前空闲的本机端口。
fn free_port() -> Result<u16, AppError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| AppError::new("NATIVE_PORT", format!("无法分配本地端口：{error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::new("NATIVE_PORT", error.to_string()))?
        .port();
    drop(listener);
    Ok(port)
}

/// 启动本机服务并等待其就绪。
pub fn start(executable: &Path, working_dir: &Path) -> Result<ServeHandle, AppError> {
    let port = free_port()?;
    // 主动指定一个随机口令：即便服务自行生成口令并打印，也以此作为兜底。
    let password = uuid::Uuid::new_v4().simple().to_string();
    let args = vec![
        "serve".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
    ];
    let mut command = proc::base_command(executable, &args)?;
    command
        .current_dir(working_dir)
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(proc::CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "NATIVE_SERVER_FAILED",
            format!("无法启动本地原生会话服务：{error}"),
        )
    })?;
    let pid = child.id();
    let captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    if let Some(stream) = child.stdout.take() {
        spawn_password_reader(stream, captured.clone());
    }
    if let Some(stream) = child.stderr.take() {
        spawn_password_reader(stream, captured.clone());
    }
    let mut handle = ServeHandle {
        child,
        pid,
        port,
        password: Some(password.clone()),
    };
    diagnostics::log(&format!(
        "启动服务：exe={}；cwd={}；端口={port}；pid={pid}",
        executable.display(),
        working_dir.display()
    ));

    // 就绪探测携带口令：经典版本会忽略该头，启用认证的版本则需要它。
    let authorization = http::basic_authorization("opencode", &password);
    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Ok(response) = http::request(
            "127.0.0.1",
            port,
            "GET",
            "/global/health",
            None,
            Some(&authorization),
        ) {
            if response.status == 200 {
                diagnostics::log(&format!("服务就绪：GET /global/health -> HTTP 200；port={port}"));
                break;
            }
        }
        if Instant::now() >= deadline {
            diagnostics::log(&format!("服务启动超时（GET /global/health 未返回 200）；port={port}"));
            handle.terminate();
            return Err(AppError::new(
                "NATIVE_SERVER_TIMEOUT",
                "本地原生会话服务启动超时。",
            ));
        }
        std::thread::sleep(POLL_INTERVAL);
    }

    // 若服务自行生成口令并打印，则以真实打印值为准（覆盖主动指定的兜底值）。
    handle.password = Some(effective_password(&password, &captured));
    match &handle.password {
        Some(actual) if actual != &password => {
            diagnostics::log("服务口令来源：服务输出（server password）");
        }
        _ => diagnostics::log("服务口令来源：环境变量（OPENCODE_SERVER_PASSWORD）"),
    }
    Ok(handle)
}

/// 在就绪后短暂等待服务打印真实口令，未打印则回退到主动指定的口令。
fn effective_password(fallback: &str, captured: &Arc<Mutex<Option<String>>>) -> String {
    let deadline = Instant::now() + PASSWORD_GRACE;
    loop {
        if let Some(found) = captured.lock().unwrap().clone() {
            return found;
        }
        if Instant::now() >= deadline {
            return fallback.to_string();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// 在后台线程中逐行读取服务输出，提取 `server password <口令>`。
fn spawn_password_reader<R: Read + Send + 'static>(
    stream: R,
    sink: Arc<Mutex<Option<String>>>,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else { break };
            if let Some(password) = parse_password_line(&line) {
                let mut guard = sink.lock().unwrap();
                if guard.is_none() {
                    *guard = Some(password);
                }
            }
        }
    });
}

/// 从一行输出中解析 `server password <口令>`（容忍大小写、冒号与 ANSI 颜色控制码）。
fn parse_password_line(line: &str) -> Option<String> {
    let cleaned = strip_ansi(line);
    let lower = cleaned.to_ascii_lowercase();
    let index = lower.find("server password")?;
    let rest = cleaned[index + "server password".len()..].trim_start();
    let rest = rest.strip_prefix(':').unwrap_or(rest).trim_start();
    let token = rest.split_whitespace().next()?;
    let token = token.trim_matches(|c| c == '"' || c == '\'' || c == '`');
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// 去除 ANSI 转义序列（形如 `ESC [ ... 字母`）。
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            // 跳过 CSI 序列，直至遇到终结字母。
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_server_password_line() {
        assert_eq!(
            parse_password_line("server password 1a2b3c4d"),
            Some("1a2b3c4d".to_string())
        );
        assert_eq!(
            parse_password_line("  server password: deadbeef  "),
            Some("deadbeef".to_string())
        );
        assert_eq!(
            parse_password_line("Server Password \"cafe\""),
            Some("cafe".to_string())
        );
        assert_eq!(parse_password_line("server listening on http://127.0.0.1:4096"), None);
        assert_eq!(parse_password_line("server password"), None);
    }

    #[test]
    fn parses_password_line_with_ansi_colors() {
        let line = "\u{1b}[32mserver password\u{1b}[0m \u{1b}[1mabc123\u{1b}[0m";
        assert_eq!(parse_password_line(line), Some("abc123".to_string()));
    }

    #[test]
    fn prefers_captured_password_over_fallback() {
        let captured = Arc::new(Mutex::new(Some("from-output".to_string())));
        assert_eq!(effective_password("fallback", &captured), "from-output");
        let empty = Arc::new(Mutex::new(None));
        assert_eq!(effective_password("fallback", &empty), "fallback");
    }
}

