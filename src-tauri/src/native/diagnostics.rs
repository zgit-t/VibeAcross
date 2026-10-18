//! 轻量诊断日志。
//!
//! VibeAcross 默认不保留任何日志，排查原生会话创建失败（例如 HTTP 405）时缺少证据。
//! 本模块把 OpenCode 原生适配器的关键交互（服务启动、接口探测、请求与响应）追加写入
//! 一个固定文件，用户复现后可直接把该文件发回分析。
//!
//! 设计要点：
//!  - 单文件、追加写入，路径固定在系统临时目录，便于用户查找与发送；
//!  - 写入失败一律忽略，绝不影响主流程（诊断日志不是产品功能，可随时移除）；
//!  - 用全局互斥串行写入，避免并发请求交叉破坏行结构。

use crate::error::AppError;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};

/// 串行化写入，保证每次追加是一整行。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 进程内首次写入时检查一次历史大小。
static INIT: Once = Once::new();

/// 日志文件大小上限；超过则在下一次进程首次写入时重置，避免无限增长。
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

/// 诊断日志的绝对路径：系统临时目录下的 `vibeacross-opencode.log`。
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("vibeacross-opencode.log")
}

/// 追加一行带时间戳的日志；任何写入错误都被静默忽略。
pub fn log(message: &str) {
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    INIT.call_once(|| {
        if std::fs::metadata(log_path())
            .map(|meta| meta.len() > MAX_LOG_BYTES)
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(log_path());
        }
    });
    let line = format!("[{}] {}\n", timestamp(), message);
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// 把响应正文压缩为单行并限长，避免超长 / 多行内容撑爆日志。
pub fn summary(body: &str, limit: usize) -> String {
    let flattened = body
        .chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control())
        .collect::<String>();
    let collapsed = flattened.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > limit {
        let truncated: String = collapsed.chars().take(limit).collect();
        format!("{truncated}…")
    } else {
        collapsed
    }
}

fn timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string()
}

/// 日志文件的当前状态。
pub struct LogState {
    /// 日志文件绝对路径。
    pub path: PathBuf,
    /// 是否已有内容（文件是否存在）。
    pub exists: bool,
    /// 文件字节数；不存在时为 0。
    pub size_bytes: u64,
}

/// 读取日志文件的当前状态（不创建文件）。
pub fn log_state() -> LogState {
    let path = log_path();
    match std::fs::metadata(&path) {
        Ok(meta) => LogState {
            path,
            exists: true,
            size_bytes: meta.len(),
        },
        Err(_) => LogState {
            path,
            exists: false,
            size_bytes: 0,
        },
    }
}

/// 供应用内查看的日志内容。
pub struct LogContent {
    /// 日志文件绝对路径。
    pub path: PathBuf,
    /// 日志正文（受 `limit` 限制，必要时仅返回末尾部分）。
    pub content: String,
    /// 是否因超出限制而截断。
    pub truncated: bool,
    /// 文件完整字节数；不存在时为 0。
    pub size_bytes: u64,
}

/// 读取日志正文，最多返回末尾 `limit` 字节（按 UTF-8 边界对齐）。
///
/// 文件不存在时返回空内容而非报错，便于界面直接展示「尚无日志」。
pub fn read_tail(limit: usize) -> LogContent {
    read_tail_from(&log_path(), limit)
}

fn read_tail_from(path: &Path, limit: usize) -> LogContent {
    let path = path.to_path_buf();
    let Ok(bytes) = std::fs::read(&path) else {
        return LogContent {
            path,
            content: String::new(),
            truncated: false,
            size_bytes: 0,
        };
    };
    let size_bytes = bytes.len() as u64;
    if bytes.len() <= limit {
        return LogContent {
            path,
            content: String::from_utf8_lossy(&bytes).into_owned(),
            truncated: false,
            size_bytes,
        };
    }
    let start = bytes.len() - limit;
    let tail = String::from_utf8_lossy(&bytes[start..]).into_owned();
    // 丢掉可能被截断的首行残余，保证每行都是完整的一行。
    let content = match tail.find('\n') {
        Some(pos) => tail[pos + 1..].to_string(),
        None => tail,
    };
    LogContent {
        path,
        content,
        truncated: true,
        size_bytes,
    }
}

/// 清空诊断日志；文件不存在时视为已清空（幂等）。
pub fn clear() -> Result<(), AppError> {
    clear_at(&log_path())
}

fn clear_at(path: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::new(
            "DIAGNOSTICS_CLEAR_FAILED",
            format!("清空诊断日志失败：{error}"),
        )),
    }
}

/// 建议的导出文件名（可识别 + `.log` 扩展名）。
pub fn suggested_file_name() -> String {
    format!(
        "VibeAcross-diagnostics-{}.log",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// 把诊断日志导出到 `target`，返回写入的字节数。
///
/// - `overwrite == false` 且目标已存在时返回 `DIAGNOSTICS_TARGET_EXISTS`；
/// - 尚无日志内容时返回 `DIAGNOSTICS_MISSING`，绝不伪造一个空文件；
/// - 先在同目录写入临时文件再原子替换，避免留下损坏的半成品。
pub fn export_to(target: &Path, overwrite: bool) -> Result<u64, AppError> {
    if target.as_os_str().is_empty() {
        return Err(AppError::new("DIAGNOSTICS_TARGET_INVALID", "未指定导出文件路径。"));
    }
    if target.is_dir() {
        return Err(AppError::new(
            "DIAGNOSTICS_TARGET_INVALID",
            "导出路径指向一个目录，请选择文件名。",
        ));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(AppError::new(
                "DIAGNOSTICS_DIR_MISSING",
                format!("导出目录不存在：{}", parent.display()),
            ));
        }
    }
    if target.exists() && !overwrite {
        return Err(AppError::new(
            "DIAGNOSTICS_TARGET_EXISTS",
            "目标文件已存在，请选择其它名称或确认覆盖。",
        ));
    }

    let content = std::fs::read(log_path()).map_err(|error| {
        AppError::new(
            "DIAGNOSTICS_MISSING",
            format!("尚无诊断日志可导出，请先在应用中复现一次原生会话操作。（{error}）"),
        )
    })?;

    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let staging = parent.join(format!(
        ".vibeacross-diagnostics-{}.tmp",
        chrono::Local::now().format("%Y%m%d%H%M%S%.3f")
    ));
    let _ = std::fs::remove_file(&staging);
    if let Err(error) = std::fs::write(&staging, &content) {
        let _ = std::fs::remove_file(&staging);
        return Err(AppError::new(
            "DIAGNOSTICS_EXPORT_FAILED",
            format!("写入诊断日志失败：{error}"),
        ));
    }
    if let Err(error) = std::fs::rename(&staging, target) {
        let _ = std::fs::remove_file(&staging);
        return Err(AppError::new(
            "DIAGNOSTICS_EXPORT_FAILED",
            format!("保存诊断日志失败：{error}"),
        ));
    }
    Ok(content.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_flattens_and_truncates() {
        assert_eq!(summary("a\r\n\tb  c", 100), "a b c");
        let long = "x".repeat(400);
        let out = summary(&long, 300);
        assert!(out.chars().count() <= 301);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn summary_keeps_short_text_intact() {
        assert_eq!(summary("HTTP 405 Method Not Allowed", 300), "HTTP 405 Method Not Allowed");
    }

    #[test]
    fn log_state_reports_path_without_creating_file() {
        let state = log_state();
        assert!(state.path.to_string_lossy().ends_with("vibeacross-opencode.log"));
        if !state.exists {
            assert_eq!(state.size_bytes, 0);
        }
    }

    #[test]
    fn export_copies_log_and_honours_overwrite() {
        log("export-test-marker-12345");
        let dir = std::env::temp_dir().join(format!(
            "vibeacross-diag-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.log");
        let _ = std::fs::remove_file(&target);

        let size = export_to(&target, false).unwrap();
        assert!(size > 0);
        let text = std::fs::read_to_string(&target).unwrap();
        assert!(text.contains("export-test-marker-12345"));

        assert_eq!(
            export_to(&target, false).unwrap_err().code,
            "DIAGNOSTICS_TARGET_EXISTS"
        );
        assert!(export_to(&target, true).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_rejects_directory_target() {
        let dir = std::env::temp_dir();
        assert_eq!(
            export_to(&dir, false).unwrap_err().code,
            "DIAGNOSTICS_TARGET_INVALID"
        );
    }

    #[test]
    fn suggested_file_name_has_log_extension() {
        let name = suggested_file_name();
        assert!(name.starts_with("VibeAcross-diagnostics-"));
        assert!(name.ends_with(".log"));
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vibeacross-diag-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("vibeacross-opencode.log")
    }

    #[test]
    fn read_tail_returns_recent_lines_and_flags_truncation() {
        let path = scratch("tail");
        let text = "[a] first\n[b] second\n[c] third\n";
        std::fs::write(&path, text).unwrap();

        let full = read_tail_from(&path, 1024);
        assert!(full.content.contains("first"));
        assert!(full.content.contains("third"));
        assert!(!full.truncated);
        assert_eq!(full.size_bytes, text.len() as u64);

        // 极小限制必然截断，且不应残留半行。
        let tiny = read_tail_from(&path, 12);
        assert!(tiny.truncated);
        assert!(tiny
            .content
            .lines()
            .all(|line| line.is_empty() || line.starts_with('[')));

        // 文件不存在时返回空内容而非报错。
        let missing = read_tail_from(&path.with_extension("missing"), 1024);
        assert!(missing.content.is_empty());
        assert_eq!(missing.size_bytes, 0);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn clear_is_idempotent() {
        let path = scratch("clear");
        std::fs::write(&path, "some log line\n").unwrap();
        clear_at(&path).unwrap();
        assert!(!path.exists());
        // 再次清空不应报错。
        clear_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
