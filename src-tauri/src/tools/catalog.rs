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
/// 这些定义是「产品支持的七款工具」的静态描述，不保存到数据库。
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
    /// 注册表卸载项 `DisplayName` **排除**关键词（不区分大小写）。
    ///
    /// 用于避免两个同品牌、名称互为子串的独立工具互相误识别（例如 Trae 的
    /// 关键词 `Trae` 会匹配到 `TRAE SOLO CN`）。命中排除词即跳过该卸载项。
    pub registry_exclude_keywords: &'static [&'static str],
    /// 注册表 `App Paths` 中登记的可执行文件名（精确匹配，不区分大小写）。
    ///
    /// 部分安装程序会把安装位置登记到
    /// `HK{CU,LM}\Software\Microsoft\Windows\CurrentVersion\App Paths\<name>`，
    /// 即使安装目录由用户自选也能据此定位，是候选路径之外最可靠的补充来源。
    pub app_paths: &'static [&'static str],
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
            r"%PROGRAMFILES(X86)%\Trae\Trae.exe",
            r"%PROGRAMFILES(X86)%\Trae CN\Trae CN.exe",
            r"%PROGRAMW6432%\Trae\Trae.exe",
            r"%PROGRAMW6432%\Trae CN\Trae CN.exe",
        ],
        registry_keywords: &["Trae"],
        // TRAE SOLO 是独立工具（见下方 `trae-solo`），不得被 Trae 误识别。
        registry_exclude_keywords: &["SOLO"],
        app_paths: &["Trae.exe", "Trae CN.exe"],
        auto_detect_reliable: true,
        version_args: &[],
        detection_note: "候选安装目录（用户级/系统级）+ App Paths 注册表项 + 卸载注册表项 + 桌面/开始菜单快捷方式（安装目录可在安装时更改）。",
        // Trae 基于 VS Code 内核，接受以目录作为唯一参数打开。
        launch_plan: LaunchPlan::Method(LaunchMethod::FolderArgument),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::Unsupported(
            "Trae 为桌面 IDE，官方未公开可调用的会话恢复方式；仅支持重新打开项目。",
        ),
    },
    ToolDefinition {
        id: "trae-solo",
        name: "TRAE SOLO",
        vendor: "ByteDance",
        description: "字节跳动的 SOLO（AI 自主开发流程）桌面应用，与 Trae IDE 相互独立。",
        tool_type: ToolType::Desktop,
        commands: &[],
        candidate_paths: &[
            r"%LOCALAPPDATA%\Programs\TRAE SOLO CN\TRAE SOLO CN.exe",
            r"%PROGRAMFILES%\TRAE SOLO CN\TRAE SOLO CN.exe",
            r"%PROGRAMFILES(X86)%\TRAE SOLO CN\TRAE SOLO CN.exe",
            r"%PROGRAMW6432%\TRAE SOLO CN\TRAE SOLO CN.exe",
        ],
        // 与 Trae IDE 的可执行文件名严格区分，避免两者互相识别。
        registry_keywords: &["TRAE SOLO"],
        registry_exclude_keywords: &[],
        app_paths: &["TRAE SOLO CN.exe"],
        auto_detect_reliable: true,
        version_args: &[],
        detection_note: "候选安装目录（用户级/系统级）+ App Paths 注册表项（TRAE SOLO CN.exe）+ 卸载注册表项 + 桌面/开始菜单快捷方式（安装目录可在安装时更改）。",
        // TRAE SOLO 与 Trae 同为 VS Code 内核（安装目录 `bin\trae-solo-cn.cmd` 即
        // VS Code CLI 包装脚本），接受以目录作为唯一参数打开。
        launch_plan: LaunchPlan::Method(LaunchMethod::FolderArgument),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::Unsupported(
            "TRAE SOLO 为桌面应用，官方未公开可调用的会话恢复方式；仅支持重新打开项目。",
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
            r"%LOCALAPPDATA%\Programs\Tencent WorkBuddy\Tencent WorkBuddy.exe",
            r"%LOCALAPPDATA%\WorkBuddy\WorkBuddy.exe",
            r"%LOCALAPPDATA%\Tencent\WorkBuddy\WorkBuddy.exe",
            r"%PROGRAMFILES%\WorkBuddy\WorkBuddy.exe",
            r"%PROGRAMFILES%\Tencent WorkBuddy\Tencent WorkBuddy.exe",
            r"%PROGRAMFILES(X86)%\WorkBuddy\WorkBuddy.exe",
            r"%PROGRAMW6432%\WorkBuddy\WorkBuddy.exe",
        ],
        registry_keywords: &["WorkBuddy"],
        registry_exclude_keywords: &[],
        app_paths: &["WorkBuddy.exe", "Tencent WorkBuddy.exe"],
        // 安装路径由用户自选，且可能通过应用商店安装，无法可靠判定未安装。
        auto_detect_reliable: false,
        version_args: &[],
        detection_note: "卸载注册表项 + App Paths 注册表项 + 常见候选目录 + 桌面/开始菜单快捷方式；安装位置不可预测，检测不到时不会判定为未安装。",
        // 官方未提供可确认的项目目录命令行参数，因此采用经验证的安全启动方式：
        // 以项目目录为工作目录、不注入任何参数地启动桌面应用（应用内需手动选择工作目录）。
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Unsupported(
            "可受控启动，但 WorkBuddy 未提供公开的项目目录启动参数，无法自动打开指定项目；请在应用内手动选择工作目录。",
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
        registry_exclude_keywords: &[],
        app_paths: &[],
        auto_detect_reliable: true,
        version_args: &["--version"],
        detection_note: "PATH 命令解析 + 官方安装目录 + 有限版本查询。",
        // 命令行工具以项目目录为工作目录启动，不传入额外参数。
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::DocumentedUnverified(
            "官方 CLI 提供 `claude --session-id <uuid>` 创建与 `claude --resume <session-id>` / `--continue` 恢复会话，已在本机端到端核实；官方未提供机器可读的历史枚举与既有会话改名接口。",
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
        registry_exclude_keywords: &[],
        app_paths: &[],
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
            r"%PROGRAMFILES(X86)%\cursor\Cursor.exe",
            r"%PROGRAMW6432%\cursor\Cursor.exe",
        ],
        registry_keywords: &["Cursor"],
        registry_exclude_keywords: &[],
        app_paths: &["Cursor.exe"],
        auto_detect_reliable: true,
        version_args: &[],
        detection_note: "候选安装目录（用户级/系统级）+ App Paths 注册表项 + 卸载注册表项 + 桌面/开始菜单快捷方式。",
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
        registry_exclude_keywords: &[],
        app_paths: &[],
        auto_detect_reliable: true,
        version_args: &["--version"],
        detection_note: "PATH 命令解析 + 官方安装目录 + 有限版本查询。",
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Project,
        session_resume: SessionResumePlan::DocumentedUnverified(
            "官方 CLI 提供 `opencode --session <id>` / `opencode --continue` 恢复会话，但需要已安装并在本机验证；本阶段不提供会话恢复操作。",
        ),
    },
    ToolDefinition {
        id: "opencode-desktop",
        name: "OpenCode Desktop",
        vendor: "OpenCode",
        description: "OpenCode 官方桌面应用（图形界面），与 OpenCode 命令行工具共用同一份本地会话存储。",
        tool_type: ToolType::Desktop,
        // 桌面应用不注册 PATH 命令，绝不使用 CLI 的 `opencode` 命令来识别它。
        commands: &[],
        candidate_paths: &[
            r"%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe",
            r"%LOCALAPPDATA%\Programs\OpenCode\OpenCode.exe",
            r"%LOCALAPPDATA%\OpenCode\OpenCode.exe",
            r"%PROGRAMFILES%\OpenCode\OpenCode.exe",
            r"%PROGRAMFILES(X86)%\OpenCode\OpenCode.exe",
            r"%PROGRAMW6432%\OpenCode\OpenCode.exe",
        ],
        // 有意不使用「卸载注册表项」来源：OpenCode CLI 通过包管理器安装时同样
        // 会登记名为 OpenCode 的卸载项，而两者可执行文件名（OpenCode.exe /
        // opencode.exe）在 Windows 上大小写不敏感、无法区分，据此会把 CLI 误判
        // 为桌面应用。宁可少一处来源，也不误报。
        registry_keywords: &[],
        registry_exclude_keywords: &[],
        app_paths: &["OpenCode.exe"],
        // 安装位置可被用户在安装时更改（观测到自定义目录，例如 D:\OpenCode），
        // 且为避免与 CLI 混淆而刻意省略卸载注册表来源；因此检测不到时不判定「未安装」。
        auto_detect_reliable: false,
        // 绝不查询版本：OpenCode.exe 是图形程序，带 --version 启动只会打开界面。
        version_args: &[],
        detection_note: "候选安装目录（用户级 Programs / LOCALAPPDATA / 系统级）+ App Paths 注册表项 + 桌面/开始菜单快捷方式；有意不使用 PATH 命令与卸载注册表项，避免把 OpenCode 命令行工具误判为桌面应用。",
        // 未核实桌面应用的项目目录命令行参数，采用经验证的安全启动方式：以项目目录
        // 作为工作目录、不注入任何参数地启动（应用内需手动打开项目）。
        launch_plan: LaunchPlan::Method(LaunchMethod::WorkingDirectory),
        restore_plan: RestorePlan::Unsupported(
            "可受控启动，但未核实 OpenCode 桌面应用的项目目录启动参数，无法自动打开指定项目；请在应用内手动打开该目录。",
        ),
        session_resume: SessionResumePlan::Unsupported(
            "OpenCode 桌面应用与命令行工具共用同一份本地会话存储；其内嵌服务仅监听随机回环端口并使用随机生成的密码，外部进程无法连接，因此不提供脚本化的会话创建 / 恢复 / 改名 / 删除，仅可只读枚举历史会话。",
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
