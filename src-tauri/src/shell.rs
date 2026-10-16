//! 与操作系统外壳交互的受控操作。
//!
//! 当前只提供「在文件管理器中打开一个已登记的项目目录」。前端只能提交项目 id，
//! 实际路径由后端从数据库读取，并在打开前重新校验存在性与类型，绝不暴露任意路径。

use crate::error::AppError;
use std::path::Path;
use std::process::Stdio;

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
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
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
