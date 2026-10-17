//! 与操作系统外壳交互的受控操作。
//!
//! 当前提供两类操作：
//!  - 在文件管理器中打开一个已登记的项目目录（前端只能提交项目 id，路径由后端读取并校验）；
//!  - 在系统默认程序中打开一个 http/https 链接（协议由后端校验，绝不执行任意命令）。
//!
//! 两者都只接受受控输入，并以独立参数形式传给系统程序，不拼接 shell 命令。

use crate::error::AppError;
use std::path::Path;
use std::process::Stdio;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows 下不弹出控制台窗口。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 在系统文件管理器中打开一个已存在且可访问的目录。
pub fn open_directory(path: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(path).map_err(|_| {
        AppError::new(
            "PROJECT_PATH_MISSING",
            format!("目录不存在或不可访问：{}", path.display()),
        )
    })?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "PROJECT_PATH_NOT_DIR",
            format!("路径不是目录：{}", path.display()),
        ));
    }

    #[cfg(windows)]
    {
        // explorer.exe 打开资源管理器窗口；只传递单个已校验的路径参数，不拼接 shell 命令。
        std::process::Command::new("explorer")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| AppError::new("OPEN_FAILED", format!("无法打开文件管理器：{error}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::new(
            "OPEN_UNSUPPORTED",
            "当前平台暂不支持打开目录。",
        ))
    }
}

/// 在系统默认程序中打开一个 http/https 链接。
///
/// 只接受 `http://` / `https://` 开头、且不含空白或控制字符的链接，随后交给系统默认
/// 处理程序（通过 explorer 的协议分发）打开，避免任何命令拼接或任意命令执行。
pub fn open_url(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    let is_http = trimmed.starts_with("https://") || trimmed.starts_with("http://");
    let has_unsafe = trimmed
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control());
    if !is_http || has_unsafe {
        return Err(AppError::new(
            "OPEN_URL_INVALID",
            "只支持打开 http/https 链接。",
        ));
    }

    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(trimmed)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| AppError::new("OPEN_FAILED", format!("无法打开链接：{error}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::new(
            "OPEN_UNSUPPORTED",
            "当前平台暂不支持打开链接。",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_url_rejects_non_http_scheme() {
        let error = open_url("ftp://example.com/file").unwrap_err();
        assert_eq!(error.code, "OPEN_URL_INVALID");
    }

    #[test]
    fn open_url_rejects_whitespace_injection() {
        let error = open_url("https://example.com/a b").unwrap_err();
        assert_eq!(error.code, "OPEN_URL_INVALID");
    }
}
