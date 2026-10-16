use serde::{Deserialize, Serialize};

/// 工具类型：桌面应用或命令行工具。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolType {
    Desktop,
    Cli,
}

impl ToolType {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolType::Desktop => "desktop",
            ToolType::Cli => "cli",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "desktop" => Some(ToolType::Desktop),
            "cli" => Some(ToolType::Cli),
            _ => None,
        }
    }
}

/// 工具配置的检测状态。
///
/// 严格区分「未检测」与「未安装」：只有在检测过程充分且可靠时才使用
/// `NotInstalled`；权限不足或检测异常时使用 `DetectionFailed`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolStatus {
    /// 已确认存在且可用。
    Detected,
    /// 尚未进行过检测。
    NotDetected,
    /// 已充分检测且确认未安装。
    NotInstalled,
    /// 已配置的路径不存在或已失效。
    PathMissing,
    /// 配置存在但无法验证（例如命令行工具未解析到可执行文件）。
    Unverified,
    /// 检测过程本身失败（权限不足、系统错误等）。
    DetectionFailed,
}

impl ToolStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ToolStatus::Detected => "detected",
            ToolStatus::NotDetected => "notDetected",
            ToolStatus::NotInstalled => "notInstalled",
            ToolStatus::PathMissing => "pathMissing",
            ToolStatus::Unverified => "unverified",
            ToolStatus::DetectionFailed => "detectionFailed",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "detected" => ToolStatus::Detected,
            "notInstalled" => ToolStatus::NotInstalled,
            "pathMissing" => ToolStatus::PathMissing,
            "unverified" => ToolStatus::Unverified,
            "detectionFailed" => ToolStatus::DetectionFailed,
            _ => ToolStatus::NotDetected,
        }
    }
}

/// 工具的受控启动方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchMethod {
    /// 将项目目录作为唯一参数传给桌面应用（VS Code 系 IDE 的通用行为）。
    FolderArgument,
    /// 以项目目录作为子进程工作目录启动命令行工具。
    WorkingDirectory,
}

/// 工具是否支持受控启动。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchSupport {
    /// 已确认可以用受控方式启动。
    Supported,
    /// 需要用户补充配置（例如缺少可执行文件路径，或安装形式无法安全启动）。
    NeedsConfiguration,
    /// 当前版本无法可靠启动（例如未知桌面应用的启动参数）。
    Unsupported,
    /// 工具未安装、路径失效或检测失败。
    Unavailable,
}

/// 工具启动能力说明，随 `ToolEntry` 一起返回给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolLaunchInfo {
    pub support: LaunchSupport,
    /// 支持启动时使用的启动方式；其余情况为 null。
    pub method: Option<LaunchMethod>,
    /// 面向用户的原因 / 说明。
    pub reason: String,
}

/// 工作上下文恢复层级（Phase 7）。
///
/// 三个层级是概念上的递进；当前版本只会实际产生 [`RestoreLevel::Project`]，
/// 其余取值保留用于校验数据库中的历史值以及后续阶段。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreLevel {
    /// 不支持受控恢复。
    None,
    /// Level 1：恢复项目、工作目录与所选开发工具。
    Project,
    /// Level 2：使用工具公开支持的方式重新打开指定会话。
    Session,
    /// Level 3：恢复会话标识与更多工具支持的工作状态。
    FullContext,
}

impl RestoreLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            RestoreLevel::None => "none",
            RestoreLevel::Project => "project",
            RestoreLevel::Session => "session",
            RestoreLevel::FullContext => "fullContext",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "none" => Some(RestoreLevel::None),
            "project" => Some(RestoreLevel::Project),
            "session" => Some(RestoreLevel::Session),
            "fullContext" => Some(RestoreLevel::FullContext),
            _ => None,
        }
    }
}

/// 开发工具对「会话恢复」（Level 2/3）的公开机制情况。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionResumeSupport {
    /// 官方未提供公开、稳定的会话恢复机制；只能重新打开项目。
    Unsupported,
    /// 官方文档提供公开的恢复命令，但当前环境尚未验证其可用性。
    DocumentedUnverified,
}

/// 工具的恢复能力说明，随 `ToolEntry` 一起返回给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRestoreInfo {
    /// 该工具当前可支持的最高恢复层级。
    pub level: RestoreLevel,
    /// 恢复层级的说明（支持或不支持的原因）。
    pub level_reason: String,
    /// 会话恢复（Level 2/3）的支持情况。
    pub session: SessionResumeSupport,
    /// 会话恢复能力的说明与已知限制。
    pub session_reason: String,
}

/// 返回给前端的工具条目。
///
/// 既包含用户已登记的安装配置（持久化），也包含内置定义派生的占位条目
/// （`source == "builtin"`，未持久化，仅用于展示「未检测 / 未安装」）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub id: String,
    pub tool_id: String,
    pub name: String,
    pub vendor: String,
    pub description: String,
    pub tool_type: ToolType,
    /// "auto"（自动检测）| "manual"（手动添加）| "builtin"（内置占位）。
    pub source: String,
    pub status: ToolStatus,
    pub executable_path: Option<String>,
    pub command_name: Option<String>,
    pub version: Option<String>,
    pub detection_method: Option<String>,
    pub is_custom: bool,
    pub is_default: bool,
    pub detected_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// 该工具是否具备可靠的自动检测方式。false 表示不会报告「未安装」。
    pub auto_detect_reliable: bool,
    /// 检测方式说明，便于向用户解释证据来源。
    pub detection_note: String,
    /// 受控启动能力与方式。
    pub launch: ToolLaunchInfo,
    /// 工作上下文恢复能力（Level 1 与更高层级的可用情况）。
    pub restore: ToolRestoreInfo,
    /// 便捷字段：status == detected。
    pub installed: bool,
}

/// 工具列表整体状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolState {
    pub entries: Vec<ToolEntry>,
    /// 最近一次全量检测时间；从未检测为 null。
    pub last_detection_at: Option<String>,
}

/// 手动添加 / 编辑工具配置的输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfigInput {
    /// 选择内置工具时提供；自定义工具留空。
    pub tool_id: Option<String>,
    /// 显示名称（自定义工具必填，内置工具可选，用于区分多个实例）。
    pub name: Option<String>,
    /// 工具类型（自定义工具必填）。
    pub tool_type: Option<ToolType>,
    /// 可执行文件路径（桌面应用或 CLI 的可执行文件）。
    pub executable_path: Option<String>,
    /// CLI 命令名称（在 PATH 中）。
    pub command_name: Option<String>,
}
