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

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
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
}
