//! 原生会话适配层使用的受控子进程工具。
//!
//! 与 [`crate::launch`] 一致：`.exe` 直接创建；`.cmd` / `.bat` 仅经受控的
//! Windows 命令解释器启动（结构化引用，绝不拼接原始 shell 字符串）。
//! 这里提供两种用法：
//!  - [`run_capture`]：运行一次性命令并捕获输出（如枚举历史会话）；
//!  - [`base_command`]：构造一个已按目标类型配置好的 [`Command`]（供长驻服务使用）。

use crate::error::AppError;
use crate::launch::{command_script_argv, windows_command_interpreter};
use crate::tools::model::{command_script_unsafe_char, is_command_script};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 不弹出控制台窗口。
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 一次性命令的执行结果。
#[derive(Debug, Clone)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// 按目标类型构造一个基础 [`Command`]（尚未设置工作目录与标准流）。
pub fn base_command(executable: &Path, args: &[String]) -> Result<Command, AppError> {
    if is_command_script(executable) {
        // 防御性校验：拒绝无法安全转义的路径 / 参数。
        let unsafe_char = executable
            .to_str()
            .and_then(command_script_unsafe_char)
            .or_else(|| args.iter().find_map(|arg| command_script_unsafe_char(arg)));
        if let Some(bad) = unsafe_char {
            return Err(AppError::new(
                "NATIVE_UNSAFE_ARG",
                format!("路径或参数包含无法安全转义的字符「{bad}」，已拒绝经命令解释器启动。"),
            ));
        }
        let argv = command_script_argv(executable, args)
            .map_err(|error| AppError::new("NATIVE_LAUNCH_FAILED", error.message))?;
        let mut command = Command::new(windows_command_interpreter());
        #[cfg(windows)]
        {
            for item in &argv {
                command.raw_arg(item);
            }
        }
        #[cfg(not(windows))]
        {
            command.args(&argv);
        }
        Ok(command)
    } else {
        let mut command = Command::new(executable);
        command.args(args);
        Ok(command)
    }
}

/// 运行一次性命令并捕获标准输出 / 标准错误；超时会终止进程并返回错误。
pub fn run_capture(
    executable: &Path,
    args: &[String],
    working_dir: &Path,
    timeout: Duration,
) -> Result<Output, AppError> {
    let mut command = base_command(executable, args)?;
    command
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| AppError::new("NATIVE_RUN_FAILED", format!("无法运行工具命令：{error}")))?;

    let stdout = child.stdout.take().map(|mut stream| {
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stream.read_to_string(&mut buffer);
            buffer
        })
    });
    let stderr = child.stderr.take().map(|mut stream| {
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stream.read_to_string(&mut buffer);
            buffer
        })
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(AppError::new("NATIVE_RUN_FAILED", error.to_string())),
        }
    };

    let stdout = stdout
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();

    match status {
        Some(status) => Ok(Output {
            code: status.code(),
            stdout,
            stderr,
        }),
        None => Err(AppError::new("NATIVE_TIMEOUT", "工具命令执行超时。")),
    }
}
