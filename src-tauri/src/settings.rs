use crate::error::AppError;
use crate::models::AppSettings;
use crate::projects::normalize_existing_dir;
use rusqlite::{params, Connection, OptionalExtension};

const KEY_DEFAULT_FOLDER: &str = "default_project_folder";
const KEY_THEME: &str = "theme";
const KEY_SHOW_LAST_CONTEXT: &str = "show_last_context_on_startup";
const KEY_AUTO_RESTORE: &str = "auto_restore_last_context";

/// 最近一次「全量」工具检测时间；从未全量检测时为缺失。
pub const KEY_TOOLS_LAST_DETECTION: &str = "tools_last_detection_at";

const VALID_THEMES: &[&str] = &["light", "dark", "system"];

pub fn read_setting(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

pub fn write_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), AppError> {
    match value {
        Some(text) if !text.is_empty() => {
            let now = crate::now_iso();
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, text, now],
            )?;
        }
        _ => {
            conn.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
        }
    }
    Ok(())
}

/// 读取布尔设置：仅当值为 "1" 时为 true，其余（缺失）为 false。
fn read_flag(conn: &Connection, key: &str) -> Result<bool, AppError> {
    Ok(read_setting(conn, key)?.as_deref() == Some("1"))
}

/// 写入布尔设置：true 写入 "1"，false 删除该项。
fn write_flag(conn: &Connection, key: &str, value: bool) -> Result<(), AppError> {
    write_setting(conn, key, value.then_some("1"))
}

/// 读取应用设置；缺失项返回 `None` / 安全默认值，由前端决定展示。
pub fn get_settings(conn: &Connection) -> Result<AppSettings, AppError> {
    Ok(AppSettings {
        default_project_folder: read_setting(conn, KEY_DEFAULT_FOLDER)?,
        theme: read_setting(conn, KEY_THEME)?,
        show_last_context_on_startup: read_flag(conn, KEY_SHOW_LAST_CONTEXT)?,
        auto_restore_last_context: read_flag(conn, KEY_AUTO_RESTORE)?,
    })
}

/// 写入应用设置。
///
/// 若 `default_project_folder` 指向不可访问的目录，返回错误且不修改任何设置，
/// 保证原有的有效设置不被打乱。
pub fn update_settings(
    conn: &Connection,
    incoming: AppSettings,
) -> Result<AppSettings, AppError> {
    // 先整体校验，再落库，避免出现半写入状态。
    let folder = match incoming.default_project_folder.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(normalize_existing_dir(raw)?),
        _ => None,
    };

    let theme = match incoming.theme.as_deref() {
        Some(raw) if !raw.trim().is_empty() => {
            let normalized = raw.trim().to_ascii_lowercase();
            if !VALID_THEMES.contains(&normalized.as_str()) {
                return Err(AppError::new(
                    "SETTING_INVALID_THEME",
                    "主题设置无效，仅支持 light、dark、system。",
                ));
            }
            Some(normalized)
        }
        _ => None,
    };

    write_setting(conn, KEY_DEFAULT_FOLDER, folder.as_deref())?;
    write_setting(conn, KEY_THEME, theme.as_deref())?;
    write_flag(conn, KEY_SHOW_LAST_CONTEXT, incoming.show_last_context_on_startup)?;
    write_flag(conn, KEY_AUTO_RESTORE, incoming.auto_restore_last_context)?;

    get_settings(conn)
}
