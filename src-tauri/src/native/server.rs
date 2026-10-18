//! 本机原生会话服务的生命周期管理。
//!
//! 目前只用于 OpenCode：通过 `opencode serve --port <P> --hostname 127.0.0.1`
//! 在回环地址上临时起一个官方 HTTP 服务，用完后可靠终止。
//!
//! 关键事实（均已在 OpenCode 1.19.0 本机核实）：
//!  - 端口通过 `bind(127.0.0.1:0)` 动态分配，避免固定端口冲突；
//!  - 就绪探测使用 `GET /global/health`；
//!  - 服务的 `dispose` 端点不会真正退出进程，因此终止必须依赖
//!    `taskkill /PID <pid> /T /F` 杀掉整个进程树。

use crate::error::AppError;
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::{diagnostics, http, proc};

/// 服务启动的最长等待时间。
const START_TIMEOUT: Duration = Duration::from_secs(25);
/// 轮询就绪的间隔。
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// 一个正在运行的本机服务句柄。
pub struct ServeHandle {
    child: Child,
    pid: u32,
    pub port: u16,
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
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(proc::CREATE_NO_WINDOW);
    }

    let child = command.spawn().map_err(|error| {
        AppError::new(
            "NATIVE_SERVER_FAILED",
            format!("无法启动本地原生会话服务：{error}"),
        )
    })?;
    let pid = child.id();
    let mut handle = ServeHandle { child, pid, port };
    diagnostics::log(&format!(
        "启动服务：exe={}；cwd={}；端口={port}；pid={pid}",
        executable.display(),
        working_dir.display()
    ));

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Ok(response) = http::request("127.0.0.1", port, "GET", "/global/health", None) {
            if response.status == 200 {
                diagnostics::log(&format!("服务就绪：GET /global/health -> HTTP 200；port={port}"));
                return Ok(handle);
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
}
