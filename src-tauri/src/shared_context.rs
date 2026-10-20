//! 共享上下文功能的残留数据清理。
//!
//! 共享上下文产品功能已退出 VibeAcross；此模块仅保留项目删除时的必要兼容清理，
//! 用于移除该项目在 `app_settings` 中的停用标记，不读写任何用户项目文件。

use crate::error::AppError;
use crate::settings;
use rusqlite::Connection;

const DISABLED_KEY_PREFIX: &str = "shared_context_disabled.";

fn disabled_key(project_id: &str) -> String {
    format!("{DISABLED_KEY_PREFIX}{project_id}")
}

/// 删除项目时清理该项目的共享上下文停用标记。
///
/// 只删除 VibeAcross 自己写入的元数据；不触碰用户项目目录中的任何文件。
pub(crate) fn forget_disabled(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    settings::write_setting(conn, &disabled_key(project_id), None)
}
