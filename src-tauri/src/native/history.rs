//! 历史会话的**结构化**能力与数据来源说明，以及查询结果状态。
//!
//! 设计目标：让用户清楚知道「历史会话从哪里来、读到了什么、能不能恢复」，
//! 并严格区分「查到了 / 没有历史 / 数据源不存在 / 无法读取 / 结构不受支持」，
//! 绝不因为「发现了数据库文件或 memory 目录」就宣称历史查询成功。
//!
//! 本模块只描述**静态能力**（每款工具的来源类型与完整度）与**查询状态**，
//! 不读取任何对话正文，也不修改任何工具数据。

use serde::Serialize;

use super::NativeSessionInfo;

/// 历史会话的数据来源类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistorySourceKind {
    /// 官方服务 / CLI 接口（如 OpenCode 的 serve / session list）。
    Service,
    /// 本地转录文件（如 Claude Code / Cursor 的 JSONL）。
    TranscriptFile,
    /// 本地会话数据库（如 WorkBuddy 的 SQLite）。
    SessionDatabase,
    /// 会话记忆摘要（如 Trae CN 的 session_memory）。
    MemorySummary,
    /// 没有可读的历史来源。
    None,
}

/// 记录相对「完整原生会话」的完整度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryCompleteness {
    /// 完整的原生会话记录（可定位到工具中的真实会话）。
    FullNative,
    /// 仅原生的会话元数据（标识 / 标题 / 时间）。
    MetadataOnly,
    /// 仅会话记忆摘要（不是完整转录）。
    SummaryOnly,
    /// 没有可用记录。
    None,
}

/// 某款工具历史会话来源的结构化说明（面向用户如实交代来源与限制）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySource {
    pub kind: HistorySourceKind,
    pub completeness: HistoryCompleteness,
    /// 是否能取得稳定的原生会话标识。
    pub stable_native_id: bool,
    /// 我们是否读取完整消息记录（本应用一律不读取对话正文）。
    pub reads_messages: bool,
    /// 是否支持恢复到工具中的指定会话。
    pub can_restore: bool,
    /// 来源的一句话说明（供界面展示）。
    pub summary: String,
    /// 已知限制（供界面展示）。
    pub limitations: String,
}

impl HistorySource {
    /// 未提供历史来源的工具：只有一个占位说明。
    const UNVERIFIED_SUMMARY: &'static str = "尚未核实该工具的历史会话数据来源，未启用历史查询。";
    const UNVERIFIED_LIMITATIONS: &'static str =
        "在核实来源与格式之前，不读取任何本地数据，也不展示推测性的会话记录。";

    /// 返回某款工具的历史来源说明。未列入的工具一律为「尚未核实」。
    pub fn for_tool(tool_id: &str) -> HistorySource {
        match tool_id {
            "opencode" => HistorySource {
                kind: HistorySourceKind::Service,
                completeness: HistoryCompleteness::FullNative,
                stable_native_id: true,
                reads_messages: false,
                can_restore: true,
                summary: "OpenCode 官方 HTTP 服务（opencode serve）与 `session list` CLI；会话为完整原生会话。"
                    .to_string(),
                limitations: "仅读取会话标识与标题，不读取对话正文。".to_string(),
            },
            "claude-code" => HistorySource {
                kind: HistorySourceKind::TranscriptFile,
                completeness: HistoryCompleteness::FullNative,
                stable_native_id: true,
                reads_messages: false,
                can_restore: true,
                summary: "本地转录目录 `~/.claude/projects/`（可由 CLAUDE_CONFIG_DIR 覆盖），每个会话一个 JSONL 文件。"
                    .to_string(),
                limitations:
                    "仅读取元数据（sessionId / cwd / summary / timestamp）；不改名、不删除原生会话。"
                        .to_string(),
            },
            "cursor" => HistorySource {
                kind: HistorySourceKind::TranscriptFile,
                completeness: HistoryCompleteness::FullNative,
                stable_native_id: true,
                reads_messages: false,
                can_restore: false,
                summary: "Cursor 本地落盘的转录目录 `~/.cursor/projects/<工作区编码>/agent-transcripts/<会话id>/<会话id>.jsonl`。"
                    .to_string(),
                limitations: "标题取自转录中的首条用户消息，属于展示标题而非原生标题；仅只读，无法创建或恢复会话。"
                    .to_string(),
            },
            "trae" => HistorySource {
                kind: HistorySourceKind::MemorySummary,
                completeness: HistoryCompleteness::SummaryOnly,
                stable_native_id: true,
                reads_messages: false,
                can_restore: false,
                summary: "Trae CN 本地会话记忆 `~/.trae-cn/memory/projects/<项目编码>/<日期>/session_memory_<会话id>.jsonl`。"
                    .to_string(),
                limitations: "仅为会话记忆摘要（标题取 intent），不是完整转录，也无法据此恢复。"
                    .to_string(),
            },
            "trae-solo" => HistorySource {
                kind: HistorySourceKind::SessionDatabase,
                completeness: HistoryCompleteness::None,
                stable_native_id: false,
                reads_messages: false,
                can_restore: false,
                summary: "TRAE SOLO 本地会话数据库 `%APPDATA%\\TRAE SOLO CN\\ModularData\\ai-agent\\database.db`。"
                    .to_string(),
                limitations: "该数据库为加密格式（非明文 SQLite），无法只读解析，因此不提供历史会话枚举，也不读取其中任何数据。"
                    .to_string(),
            },
            "workbuddy" => HistorySource {
                kind: HistorySourceKind::SessionDatabase,
                completeness: HistoryCompleteness::MetadataOnly,
                stable_native_id: true,
                reads_messages: false,
                can_restore: false,
                summary: "WorkBuddy 本地数据库 `~/.workbuddy/workbuddy.db` 的 `sessions` 表，按 `cwd` 归属当前项目。"
                    .to_string(),
                limitations: "仅读取会话元数据（id / 标题 / 时间 / cwd）；数据库以只读方式打开，不修改 / 迁移 / 删除。"
                    .to_string(),
            },
            "opencode-desktop" => HistorySource {
                kind: HistorySourceKind::SessionDatabase,
                completeness: HistoryCompleteness::FullNative,
                stable_native_id: true,
                reads_messages: false,
                can_restore: false,
                summary: "与 OpenCode 命令行工具共用同一份本地会话数据库 `~/.local/share/opencode/opencode.db`（表 `session`）；以只读方式枚举会话元数据（id / 标题 / 目录 / 时间），排除已归档会话。"
                    .to_string(),
                limitations: "仅读取会话元数据，不读取对话正文。桌面应用内嵌的本地服务仅监听随机回环端口并使用随机生成的密码（Basic 认证、来源限于应用自身），外部进程无法连接，因此不提供创建 / 恢复 / 改名 / 删除，也不写入 / 迁移 / 删除任何数据。"
                    .to_string(),
            },
            _ => HistorySource {
                kind: HistorySourceKind::None,
                completeness: HistoryCompleteness::None,
                stable_native_id: false,
                reads_messages: false,
                can_restore: false,
                summary: HistorySource::UNVERIFIED_SUMMARY.to_string(),
                limitations: HistorySource::UNVERIFIED_LIMITATIONS.to_string(),
            },
        }
    }
}

/// 一次历史查询的**数据源状态**。刻意把「没有历史」与「读取失败」等区分开。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryQueryState {
    /// 数据源存在且可读取（可能 0 条记录，即确实还没有历史）。
    Available,
    /// 数据源不存在（该工具尚未在本机产生历史数据）。
    SourceMissing,
    /// 数据源存在但无法读取（权限 / IO / 解析失败）。
    Unreadable,
    /// 数据源存在但结构不受支持（如加密数据库 / 未知格式）。
    StructureUnsupported,
}

/// 一次历史查询的结果：状态 + 枚举到的会话（可能为空）。
#[derive(Debug, Clone)]
pub struct HistoryListing {
    pub state: HistoryQueryState,
    pub items: Vec<NativeSessionInfo>,
}

impl HistoryListing {
    pub fn available(items: Vec<NativeSessionInfo>) -> Self {
        Self {
            state: HistoryQueryState::Available,
            items,
        }
    }

    pub fn source_missing() -> Self {
        Self {
            state: HistoryQueryState::SourceMissing,
            items: Vec::new(),
        }
    }

    pub fn unreadable() -> Self {
        Self {
            state: HistoryQueryState::Unreadable,
            items: Vec::new(),
        }
    }

    pub fn structure_unsupported() -> Self {
        Self {
            state: HistoryQueryState::StructureUnsupported,
            items: Vec::new(),
        }
    }

    /// 把能力不支持 / 未核实的错误如实转换为「结构不受支持」以外的错误，交由上层处理。
    pub fn is_available(&self) -> bool {
        self.state == HistoryQueryState::Available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_tools_report_expected_source_kind_and_completeness() {
        assert_eq!(
            HistorySource::for_tool("cursor").kind,
            HistorySourceKind::TranscriptFile
        );
        assert_eq!(
            HistorySource::for_tool("trae").completeness,
            HistoryCompleteness::SummaryOnly
        );
        let solo = HistorySource::for_tool("trae-solo");
        assert_eq!(solo.kind, HistorySourceKind::SessionDatabase);
        assert_eq!(solo.completeness, HistoryCompleteness::None);
        assert!(!solo.stable_native_id);
        assert!(!solo.can_restore);
        assert_eq!(
            HistorySource::for_tool("workbuddy").completeness,
            HistoryCompleteness::MetadataOnly
        );
        assert_eq!(
            HistorySource::for_tool("opencode").completeness,
            HistoryCompleteness::FullNative
        );
        let desktop = HistorySource::for_tool("opencode-desktop");
        assert_eq!(desktop.kind, HistorySourceKind::SessionDatabase);
        assert_eq!(desktop.completeness, HistoryCompleteness::FullNative);
    }

    #[test]
    fn restore_is_only_claimed_where_backend_actually_supports_it() {
        assert!(HistorySource::for_tool("opencode").can_restore);
        assert!(HistorySource::for_tool("claude-code").can_restore);
        assert!(!HistorySource::for_tool("cursor").can_restore);
        assert!(!HistorySource::for_tool("trae").can_restore);
        assert!(!HistorySource::for_tool("trae-solo").can_restore);
        assert!(!HistorySource::for_tool("workbuddy").can_restore);
    }

    #[test]
    fn unknown_tool_is_reported_as_unverified_not_supported() {
        let source = HistorySource::for_tool("codex-cli");
        assert_eq!(source.kind, HistorySourceKind::None);
        assert_eq!(source.completeness, HistoryCompleteness::None);
        assert!(!source.stable_native_id);
        assert!(!source.can_restore);
    }

    #[test]
    fn opencode_desktop_has_shared_local_store_and_is_distinct_from_cli_kind() {
        let desktop = HistorySource::for_tool("opencode-desktop");
        assert_eq!(desktop.kind, HistorySourceKind::SessionDatabase);
        assert_eq!(desktop.completeness, HistoryCompleteness::FullNative);
        assert!(desktop.stable_native_id);
        assert!(!desktop.reads_messages);
        assert!(!desktop.can_restore);
        // 与命令行工具同源，但来源种类不同：CLI 经官方服务，桌面端经共用本地数据库。
        let cli = HistorySource::for_tool("opencode");
        assert_eq!(cli.kind, HistorySourceKind::Service);
        assert!(cli.can_restore);
        assert_ne!(desktop.kind, cli.kind);
    }

    #[test]
    fn no_source_reads_full_messages() {
        for tool in [
            "opencode",
            "opencode-desktop",
            "claude-code",
            "cursor",
            "trae",
            "trae-solo",
            "workbuddy",
        ] {
            assert!(
                !HistorySource::for_tool(tool).reads_messages,
                "{tool} 不应声称读取完整消息记录"
            );
        }
    }
}
