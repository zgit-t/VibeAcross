//! TRAE SOLO 桌面应用的原生会话适配器（只读；**无可用历史来源**）。
//!
//! TRAE SOLO 与 Trae IDE 是相互独立的桌面应用，二者可执行文件、安装目录与数据目录
//! 均不同。本适配器仅负责 SOLO，绝不读取或复用 Trae CN 的记忆目录。
//!
//! 能力依据：TRAE SOLO 未提供创建 / 恢复 / 改名 / 删除 AI 会话的命令行接口（其安装
//! 目录下的 `bin\trae-solo-cn.cmd` 只是 VS Code 风格的目录 / 文件打开器）。本地会话
//! 数据库位于 `%APPDATA%\TRAE SOLO CN\ModularData\ai-agent\database.db`，本机核实其
//! 文件头（`05 AB EC D3 ...`）并非 SQLite 明文格式，为**加密格式**，无法只读解析。
//!
//! 因此本适配器**不读取** SOLO 的任何会话数据：枚举历史时如实返回「结构不受支持」，
//! 绝不把缓存 / 草稿 / 其它工具的记录伪装成 SOLO 的历史会话。

use crate::error::AppError;

use super::history::HistoryListing;
use super::{NativeSessionInfo, ToolContext};

/// 枚举 TRAE SOLO 历史会话：其数据库为加密格式，无法只读解析，故如实报错。
pub fn list(ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
    let _ = ctx;
    Err(AppError::new(
        "NATIVE_LIST_FAILED",
        "TRAE SOLO 的本地会话数据库为加密格式，暂无法只读解析；已取消读取，未伪造任何会话记录。",
    ))
}

/// 带来源状态的枚举：数据源格式不受支持（加密数据库），不返回任何会话。
pub fn list_with_state(ctx: &ToolContext) -> Result<HistoryListing, AppError> {
    let _ = ctx;
    Ok(HistoryListing::structure_unsupported())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native::history::HistoryQueryState;
    use std::path::PathBuf;

    fn ctx() -> ToolContext {
        ToolContext {
            tool_id: "trae-solo".to_string(),
            tool_name: "TRAE SOLO".to_string(),
            executable: PathBuf::from(r"D:\TRAE SOLO CN\TRAE SOLO CN.exe"),
            working_dir: PathBuf::from(r"D:\works\waterbill"),
        }
    }

    #[test]
    fn list_reports_encrypted_database_without_fabricating_sessions() {
        let error = list(&ctx()).unwrap_err();
        assert_eq!(error.code, "NATIVE_LIST_FAILED");
    }

    #[test]
    fn list_with_state_is_structure_unsupported_and_empty() {
        let listing = list_with_state(&ctx()).unwrap();
        assert_eq!(listing.state, HistoryQueryState::StructureUnsupported);
        assert!(listing.items.is_empty());
    }
}
