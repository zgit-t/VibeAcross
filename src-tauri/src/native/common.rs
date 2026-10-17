//! 桌面类工具（Cursor / Trae / WorkBuddy）原生会话适配器共用的**纯函数**辅助。
//!
//! 这些工具都没有公开的会话命令行接口，历史会话只能从各自的**本地**数据文件 /
//! 数据库中**只读**解析。本模块只提供路径编码、时间转换与标题清理等纯函数，
//! 不读取任何会话内容，也不修改任何工具数据。

use std::path::{Path, PathBuf};

/// 解析当前用户主目录（Windows 优先 `USERPROFILE`，其余回退 `HOME` / `HOMEDRIVE`+`HOMEPATH`）。
pub fn user_home() -> Option<PathBuf> {
    for key in ["USERPROFILE", "HOME"] {
        if let Some(value) = std::env::var_os(key) {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            let mut combined = PathBuf::from(drive);
            combined.push(path);
            Some(combined)
        }
        _ => None,
    }
}

/// 规范化绝对路径以便比对：统一分隔符、去尾部斜杠、忽略大小写。
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

/// 将绝对路径编码为工作区目录名（与 Cursor / Trae 的本地目录约定一致）。
///
/// 规则：连续的「非字母数字字符」压缩为单个 `-`，去掉首尾 `-`，整体小写。
/// 该编码是**有损**的，只用于「正向匹配当前项目」，绝不据此反转出真实路径。
///
/// 例：`D:\works\waterbill` → `d-works-waterbill`；
///     `C:\Users\ZZZ\Desktop\AIhtml\1` → `c-users-zzz-desktop-aihtml-1`。
pub fn encode_dir_name(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut in_separator = false;
    for ch in path.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            in_separator = false;
        } else if !in_separator {
            out.push('-');
            in_separator = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// 文件最后修改时间 → RFC3339 字符串。
pub fn file_modified_iso(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let datetime: chrono::DateTime<chrono::Utc> = modified.into();
    Some(datetime.to_rfc3339())
}

/// 毫秒级 Unix 时间戳 → RFC3339 字符串（UTC）。
pub fn epoch_millis_to_iso(millis: i64) -> Option<String> {
    let datetime = chrono::DateTime::from_timestamp_millis(millis)?;
    Some(datetime.to_rfc3339())
}

/// 清理候选标题：去除尖括号标签（如 `<timestamp>` / `<user_query>`）、
/// 转义换行与多余空白，压缩为单行，并按字符数截断（超长追加省略号）。
///
/// 仅用于本地生成**显示标题**，不改变任何原生数据；无效内容返回 `None`。
pub fn sanitize_title(raw: &str, max_chars: usize) -> Option<String> {
    // 天然换行的转义写法（源文本常见字面量 `\n` / `\r`）先还原为空白。
    let without_escapes = raw.replace("\\r\\n", " ").replace("\\n", " ").replace("\\r", " ");
    // 去掉 <...> 标签内容。
    let mut stripped = String::with_capacity(without_escapes.len());
    let mut in_tag = false;
    for ch in without_escapes.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if in_tag => {}
            _ => stripped.push(ch),
        }
    }
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    let mut result: String = collapsed.chars().take(max_chars).collect();
    if collapsed.chars().count() > max_chars {
        result.push('…');
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_collapses_separators_and_lowercases() {
        assert_eq!(encode_dir_name(r"D:\works\waterbill"), "d-works-waterbill");
        assert_eq!(
            encode_dir_name(r"C:\Users\ZZZ\Desktop\AIhtml\1"),
            "c-users-zzz-desktop-aihtml-1"
        );
        assert_eq!(encode_dir_name("/Users/me/proj"), "users-me-proj");
    }

    #[test]
    fn normalize_ignores_separators_case_and_trailing_slash() {
        assert_eq!(normalize_path(r"C:\Work\Proj\"), normalize_path("c:/work/proj"));
    }

    #[test]
    fn sanitize_strips_tags_and_collapses_whitespace() {
        let raw = "<user_query>\n修复 布局\n问题\\n继续 </user_query>";
        assert_eq!(sanitize_title(raw, 80).as_deref(), Some("修复 布局 问题 继续"));
    }

    #[test]
    fn sanitize_truncates_with_ellipsis() {
        let long = "甲".repeat(120);
        let title = sanitize_title(&long, 10).unwrap();
        assert_eq!(title.chars().count(), 11);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn sanitize_returns_none_for_blank() {
        assert!(sanitize_title("   \n\t ", 80).is_none());
        assert!(sanitize_title("<timestamp></timestamp>", 80).is_none());
    }

    #[test]
    fn epoch_millis_converts_to_rfc3339() {
        assert_eq!(
            epoch_millis_to_iso(0).as_deref(),
            Some("1970-01-01T00:00:00+00:00")
        );
        assert!(epoch_millis_to_iso(1_789_117_324_544).is_some());
    }
}
