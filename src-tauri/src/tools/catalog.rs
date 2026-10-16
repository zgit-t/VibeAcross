use crate::tools::model::{LaunchMethod, ToolType};

/// 内置工具的受控启动计划。
///
/// 只有已经确认参数兼容的工具才标记为可启动；无法确认的一律保持保守。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchPlan {
    /// 支持，且以指定方式启动。
    Method(LaunchMethod),
    /// 当前版本无法可靠启动，附说明。
    Unsupported(&'static str),
}

impl LaunchPlan {
    pub fn method(self) -> Option<LaunchMethod> {
        match self {
            LaunchPlan::Method(method) => Some(method),
            LaunchPlan::Unsupported(_) => None,
        }
    }
}

/// 工作上下文恢复计划（Level 1）。
///
/// Level 1 复用受控启动：把项目目录与所选工具恢复起来。只有「可启动」的工具
/// 才支持 Level 1；无法确认启动方式的工具一律为 `Unsupported`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestorePlan {
    /// 支持恢复项目与工作目录。
    Project,
    /// 当前无法受控恢复，附说明。
    Unsupported(&'static str),
}

/// 会话恢复（Level 2/3）的公开机制情况。
///
/// 只有工具官方文档提供了公开、稳定的恢复命令时，才标记为
/// `DocumentedUnverified`；桌面应用等没有公开机制的一律为 `Unsupported`。
/// 本阶段不提供会话恢复操作，仅如实向用户展示能力与限制。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionResumePlan {
    /// 官方未提供公开、稳定的会话恢复机制。
    Unsupported(&'static str),
    /// 官方文档提供公开的恢复命令，但当前环境尚未验证。
    DocumentedUnverified(&'static str),
}

/// 内置工具定义。
///
/// 这些定义是「产品支持的六款工具」的静态描述，不保存到数据库。
/// 检测结果与用户配置保存在 `tool_installations` 表中，二者按 `id` 关联。
pub struct ToolDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub vendor: &'static str,
    pub description: &'static str,
    pub tool_type: ToolType,
    /// CLI 命令名称候选（在系统 PATH 中查找）。
    pub commands: &'static [&'static str],
    /// 候选可执行文件路径，支持 `%VAR%` 环境变量展开。
    pub candidate_paths: &'static [&'static str],
    /// 注册表卸载项 `DisplayName` 匹配关键词（不区分大小写）。
    pub registry_keywords: &'static [&'static str],
    /// 自动检测是否可靠。
    ///
    /// false 表示安装位置不可预测（例如由用户自选或通过应用商店安装），
    /// 此时即使检测不到也不会报告「未安装」，只提示手动配置。
    pub auto_detect_reliable: bool,
    /// 版本查询参数（仅对 `.exe` 生效，避免调用 shell）。
    pub version_args: &'static [&'static str],
    /// 检测方式说明。
    pub detection_note: &'static str,
    /// 受控启动计划。
    pub launch_plan: LaunchPlan,
    /// 工作上下文恢复计划（Level 1）。
    pub restore_plan: RestorePlan,
    /// 会话恢复（Level 2/3）的公开机制情况。
    pub session_resume: SessionResumePlan,
}

const CATALOG: &[ToolDefinition] = &[
    ToolDefinition {
        id: "trae",
        name: "Trae",
        vendor: "ByteDance",
        description: "面向开发者的 AI 集成开发环境。",
        tool_type: ToolType::Desktop,
        commands: &[],
        candidate_paths: &[
            r"%LOCALAPPDATA%\Programs\Trae\Trae.exe",
            r"%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe",
            r"%PROGRAMFILES%\Trae\Trae.exe",
            r"%PROGRAMFILES%\Trae CN\Trae CN.exe",
        ],
        registry_keywords: &["Trae"],
        auto_detect_reliable: true,
        version_args: &[],
        detection_note: "候选安装目录 + 卸载注册表项（安装目录可在安装时更改）。",
        // Trae 基于 VS Code 内核，接受以目录作为唯一参数打开。
        launch_plan: LaunchPlan::Method(LaunchMethod::FolderArgument),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::Unsupported(
            "Trae 为桌面 IDE，官方未公开可调用的会话恢复方式；仅支持重新打开项目。",
        ),
    },
    ToolDefinition {
        id: "workbuddy",
        name: "WorkBuddy",
        vendor: "Tencent",
        description: "腾讯 WorkBuddy AI 办公/编程代理桌面应用。",
        tool_type: ToolType::Desktop,
        commands: &[],
        candidate_paths: &[
            r"%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe",
            r"%LOCALAPPDATA%\WorkBuddy\WorkBuddy.exe",
            r"%LOCALAPPDATA%\Tencent\WorkBuddy\WorkBuddy.exe",
            r"%PROGRAMFILES%\WorkBuddy\WorkBuddy.exe",
        ],
        registry_keywords: &["WorkBuddy"],
        // 安装路径由用户自选，且可能通过应用商店安装，无法可靠判定未安装。
        auto_detect_reliable: false,
        version_args: &[],
        detection_note: "卸载注册表项 + 常见候选目录；安装位置不可预测，检测不到时不会判定为未安装。",
        // 官方未提供可确认的命令行启动参数，保持保守，不假设与其它 IDE 相同。
        launch_plan: LaunchPlan::Unsupported(
            "尚未确认 WorkBuddy 的命令行启动参数，暂不支持受控启动。可在该应用中手动打开项目目录。",
        ),
        restore_plan: RestorePlan::Unsupported(
            "无法受控启动，因此也无法自动恢复工作环境。请在 WorkBuddy 中手动打开项目目录。",
        ),
        session_resume: SessionResumePlan::Unsupported(
            "官方未公开可调用的会话恢复方式。",
        ),
    },
    ToolDefinition {
        id: "claude-code",
        name: "Claude Code",
        vendor: "Anthropic",
        description: "终端中的 AI 编程代理。",
        tool_type: ToolType::Cli,
        commands: &["claude"],
        candidate_paths: &[
            r"%USERPROFILE%\.local\bin\claude.exe",
            r"%APPDATA%\npm\claude.cmd",
        ],
        registry_keywords: &[],
        auto_detect_reliable: true,
        version_args: &["--version"],
        detection_note: "PATH 命令解析 + 官方安装目录 + 有限版本查询。",
        // 命令行工具以项目目录为工作目录启动，不传入额外参数。
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::DocumentedUnverified(
            "官方 CLI 提供 `claude --resume <session-id>` / `--continue` 恢复会话，但需要已安装并在本机验证；本阶段不提供会话恢复操作。",
        ),
    },
    ToolDefinition {
        id: "codex-cli",
        name: "OpenAI Codex CLI",
        vendor: "OpenAI",
        description: "OpenAI 提供的命令行编码助手。",
        tool_type: ToolType::Cli,
        commands: &["codex"],
        candidate_paths: &[
            r"%APPDATA%\npm\codex.cmd",
            r"%USERPROFILE%\.local\bin\codex.exe",
            r"%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe",
        ],
        registry_keywords: &[],
        auto_detect_reliable: true,
        version_args: &["--version"],
        detection_note: "PATH 命令解析 + npm/官方安装目录 + 有限版本查询。",
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::DocumentedUnverified(
            "官方 CLI 提供 `codex resume [SESSION_ID]` / `codex resume --last` 恢复会话，但需要已安装并在本机验证；本阶段不提供会话恢复操作。",
        ),
    },
    ToolDefinition {
        id: "cursor",
        name: "Cursor",
        vendor: "Anysphere",
        description: "AI 优先的代码编辑器。",
        tool_type: ToolType::Desktop,
        commands: &[],
        candidate_paths: &[
            r"%LOCALAPPDATA%\Programs\cursor\Cursor.exe",
            r"%PROGRAMFILES%\cursor\Cursor.exe",
        ],
        registry_keywords: &["Cursor"],
        auto_detect_reliable: true,
        version_args: &[],
        detection_note: "候选安装目录（用户级/系统级）+ 卸载注册表项。",
        // Cursor 基于 VS Code 内核，接受以目录作为唯一参数打开。
        launch_plan: LaunchPlan::Method(LaunchMethod::FolderArgument),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::Unsupported(
            "Cursor 为桌面编辑器，官方未公开 AI 会话恢复命令；仅支持重新打开项目。",
        ),
    },
    ToolDefinition {
        id: "opencode",
        name: "OpenCode",
        vendor: "OpenCode",
        description: "开源终端 AI 编程代理。",
        tool_type: ToolType::Cli,
        commands: &["opencode"],
        candidate_paths: &[
            r"%USERPROFILE%\.opencode\bin\opencode.exe",
            r"%APPDATA%\npm\opencode.cmd",
        ],
        registry_keywords: &[],
        auto_detect_reliable: true,
        version_args: &["--version"],
        detection_note: "PATH 命令解析 + 官方安装目录 + 有限版本查询。",
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::DocumentedUnverified(
            "官方 CLI 提供 `opencode --session <id>` / `opencode --continue` 恢复会话，但需要已安装并在本机验证；本阶段不提供会话恢复操作。",
        ),
    },
];

pub fn all() -> &'static [ToolDefinition] {
    CATALOG
}

pub fn find(id: &str) -> Option<&'static ToolDefinition> {
    CATALOG.iter().find(|definition| definition.id == id)
}

/// 内置工具在目录中的顺序（用于稳定排序）。
pub fn index_of(id: &str) -> Option<usize> {
    CATALOG.iter().position(|definition| definition.id == id)
}

/// 展开 `%VAR%` 形式的候选路径。缺少环境变量时返回 None。
pub fn expand_candidate(raw: &str) -> Option<String> {
    let mut result = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '%' {
            let mut name = String::new();
            let mut closed = false;
            for inner in chars.by_ref() {
                if inner == '%' {
                    closed = true;
                    break;
                }
                name.push(inner);
            }
            if !closed {
                return None;
            }
            match std::env::var(&name) {
                Ok(value) if !value.is_empty() => result.push_str(&value),
                _ => return None,
            }
        } else {
            result.push(ch);
        }
    }

    Some(result)
}
