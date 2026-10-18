//! AI 工具「原生会话」适配层。
//!
//! 目标：让 VibeAcross 能在**当前项目目录**下，借助各工具**官方公开**的接口
//! 创建真实原生会话、发现历史会话、恢复指定原生会话，同时绝不虚构命令 / 参数。
//!
//! 设计原则：
//!  - 能力必须显式区分「支持 / 不支持 / 尚未核实」，未核实的能力一律不当作支持；
//!  - 只有在工具**真实创建**会话并返回标识后，才写入本地会话记录，且该标识必须来自工具；
//!  - 创建成功但本地保存失败时执行补偿（删除刚创建的原生会话），避免留下孤儿会话；
//!  - 恢复前先确认原生会话仍然存在，缺失时如实报错，绝不静默新建；
//!  - 只读取会话元数据，绝不读取 / 保存任何对话内容。
//!
//! 本模块通过 [`NativeBackend`] 抽象外部交互，测试可注入记录型实现而不真正调用工具。

pub mod claude;
pub mod common;
pub mod cursor;
pub mod diagnostics;
pub mod history;
pub mod http;
pub mod opencode;
pub mod opencode_desktop;
pub mod proc;
pub mod server;
pub mod trae;
pub mod trae_solo;
pub mod workbuddy;

pub use history::{
    HistoryCompleteness, HistoryListing, HistoryQueryState, HistorySource, HistorySourceKind,
};

use crate::error::AppError;
use crate::launch::{self, LaunchGuard, LaunchResult, ProcessLauncher};
use crate::project_tools;
use crate::projects;
use crate::sessions::{self, Session};
use crate::tools::detect::Detector;
use crate::tools::service as tools;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 某项原生会话能力的支持程度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Support {
    /// 已在本机核实可用。
    Supported,
    /// 工具本身不提供该能力。
    Unsupported,
    /// 尚未核实，绝不能当作支持。
    NotVerified,
}

/// 一款工具的原生会话能力矩阵。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCapabilities {
    pub tool_id: String,
    pub create: Support,
    pub list: Support,
    pub restore: Support,
    /// 工具是否公开提供可用于定位会话的原生标识。
    pub native_id: Support,
    pub rename_title: Support,
    /// 是否可删除指定的原生会话（不是清空整个会话存储）。
    pub delete: Support,
    /// 历史会话的数据来源与限制（结构化，供界面如实展示）。
    pub history: HistorySource,
    /// 能力的核实依据与已知限制（面向用户如实说明）。
    pub notes: String,
}

/// 一条原生会话的公开信息（不含任何对话内容）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionInfo {
    pub native_id: String,
    pub title: Option<String>,
    pub directory: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// 执行原生会话操作所需的工具上下文。
#[derive(Debug, Clone)]
pub struct ToolContext {
    /// 内置工具标识（如 "opencode"），用于能力判定与适配器分发。
    pub tool_id: String,
    pub tool_name: String,
    pub executable: PathBuf,
    /// 会话所属项目目录。
    pub working_dir: PathBuf,
}

/// 返回某款内置工具的原生会话能力矩阵。
///
/// 依据：OpenCode 1.19.0 与 Claude Code 2.1.301 均在本机核实过公开接口；
/// 桌面类工具未提供会话接口；未安装 / 未核实的工具一律标记为「尚未核实」。
pub fn capabilities_for(tool_id: &str) -> SessionCapabilities {
    let (create, list, restore, native_id, rename_title, delete, notes) = match tool_id {
        "opencode" => (
            Support::Supported,
            Support::Supported,
            Support::Supported,
            Support::Supported,
            Support::Supported,
            Support::Supported,
            "已在 OpenCode 1.19.0 本机核实：经官方 HTTP 服务（opencode serve）创建 / 查询 / 删除会话与修改标题，经 `session list --format json` 枚举历史，经 `--session <id>` 恢复。会话接口依据服务自带的 OpenAPI 文档（`/doc`）在经典接口（`/session`）与 v2 接口（`/api/session`）之间据实选择，以兼容不同版本 / 连接模式；删除会话仅删除指定会话，不触碰其它会话。",
        ),
        "claude-code" => (
            Support::Supported,
            Support::Supported,
            Support::Supported,
            Support::Supported,
            Support::Unsupported,
            Support::Unsupported,
            "已在 Claude Code 2.1.301 本机端到端核实：以 `claude --session-id <uuid>` 绑定调用方生成的原生标识开新会话，以 `claude --resume <id>` 恢复既有会话（经 `-p --output-format json` 确认 session_id 一致）。历史会话枚举基于官方公开的本地转录目录（`~/.claude/projects/`，可由 `CLAUDE_CONFIG_DIR` 覆盖），每个会话一个 JSONL 文件；仅读取其元数据（sessionId / cwd / summary / timestamp），据权威的 `cwd` 字段归属项目，不解析任何消息内容。官方仍未提供对既有会话的命令行改名（`-n` 仅创建时可用）与删除接口，因此不启用标题同步与原生删除。",
        ),
        "cursor" => (
            Support::Unsupported,
            Support::Supported,
            Support::Unsupported,
            Support::Supported,
            Support::Unsupported,
            Support::Unsupported,
            "Cursor 为桌面编辑器，未提供创建 / 恢复 / 改名 / 删除 AI 会话的命令行接口；仅支持以项目目录打开。历史会话以只读方式来自 Cursor 本地落盘的转录目录（`~/.cursor/projects/<工作区编码>/agent-transcripts/<会话id>/<会话id>.jsonl`），据目录编码正向归属当前项目，标题优先取转录中首条有效用户消息（清理截断），否则回退「会话 <短ID>」。不读写完整对话正文，也不写入任何记录。",
        ),
        "trae" => (
            Support::Unsupported,
            Support::Supported,
            Support::Unsupported,
            Support::Supported,
            Support::Unsupported,
            Support::Unsupported,
            "Trae 为桌面 IDE，未提供创建 / 恢复 / 改名 / 删除 AI 会话的命令行接口；仅支持以项目目录打开。历史会话以只读方式来自 Trae CN 的本地会话记忆（`~/.trae-cn/memory/projects/<项目编码>/<日期>/session_memory_<会话id>.jsonl`，同一会话的多个日期快照会去重取最新），标题取记忆中的 `intent`。注意：该来源为会话记忆摘要而非完整转录，据此无法恢复会话。",
        ),
        "trae-solo" => (
            Support::Unsupported,
            Support::Unsupported,
            Support::Unsupported,
            Support::Unsupported,
            Support::Unsupported,
            Support::Unsupported,
            "TRAE SOLO 为独立于 Trae IDE 的桌面应用，未提供创建 / 恢复 / 改名 / 删除 AI 会话的命令行接口；仅支持以项目目录打开。其本地会话数据库（`%APPDATA%\\TRAE SOLO CN\\ModularData\\ai-agent\\database.db`）为加密格式，无法以只读方式解析，因此不提供历史会话枚举，也不读取其中任何数据。",
        ),
            "workbuddy" => (
                Support::Unsupported,
                Support::Supported,
                Support::Unsupported,
                Support::Supported,
                Support::Unsupported,
                Support::Unsupported,
                "WorkBuddy 为桌面应用，未提供创建 / 恢复 / 改名 / 删除会话的接口；仅支持以项目目录启动。历史会话以只读方式来自其本地数据库 `~/.workbuddy/workbuddy.db` 的 `sessions` 表，按 `cwd` 字段归属当前项目，标题取 `custom_title` / `title`，时间取 `created_at` / `updated_at`；`~/.workbuddy/sessions/<pid>.json` 仅为运行中的守护进程状态，不作为会话历史。数据库全程只读，不修改 / 迁移 / 删除原始数据。",
            ),
            "opencode-desktop" => (
                Support::Unsupported,
                Support::Supported,
                Support::Unsupported,
                Support::Supported,
                Support::Unsupported,
                Support::Unsupported,
                "OpenCode 桌面应用是图形界面外壳，内部运行与 `opencode` 命令行工具相同的 OpenCode 服务内核，并共用同一份本地会话存储（`%USERPROFILE%\\.local\\share\\opencode\\opencode.db`，SQLite；会话表 `session`）。因此其历史会话与命令行工具同源：以只读方式直接查询该数据库，据 `directory` 字段归属当前项目、排除已归档会话，标题取自 `title`。桌面应用内嵌的本地服务仅监听随机回环端口并使用每次启动随机生成的密码（Basic 认证、来源限于应用自身），外部进程无法连接；其可执行文件为图形程序，不能作为无头服务启动。故不提供创建 / 恢复 / 改名 / 删除能力，也不写入任何数据。",
            ),
            _ => (
            Support::NotVerified,
            Support::NotVerified,
            Support::NotVerified,
            Support::NotVerified,
            Support::NotVerified,
            Support::NotVerified,
            "尚未核实该工具是否提供原生会话接口，暂不启用相关操作。",
        ),
    };
    SessionCapabilities {
        tool_id: tool_id.to_string(),
        create,
        list,
        restore,
        native_id,
        rename_title,
        delete,
        history: HistorySource::for_tool(tool_id),
        notes: notes.to_string(),
    }
}

/// 原生会话后端：按工具分发到具体适配器。测试注入假实现。
pub trait NativeBackend: Send + Sync {
    fn capabilities(&self, tool_id: &str) -> SessionCapabilities;
    fn create(&self, ctx: &ToolContext, title: Option<&str>)
        -> Result<NativeSessionInfo, AppError>;
    fn list(&self, ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError>;
    /// 带数据源状态的枚举。默认实现把 `list` 的结果视为「数据源可用」，
    /// 供测试替身使用；真实后端按工具区分来源缺失 / 无法读取 / 结构不受支持。
    fn list_with_state(&self, ctx: &ToolContext) -> Result<HistoryListing, AppError> {
        Ok(HistoryListing::available(self.list(ctx)?))
    }
    fn get(&self, ctx: &ToolContext, native_id: &str) -> Result<Option<NativeSessionInfo>, AppError>;
    fn rename_title(&self, ctx: &ToolContext, native_id: &str, title: &str) -> Result<(), AppError>;
    /// 删除指定的原生会话（绝不删除整个会话存储或项目目录）。
    ///
    /// 既用于「创建失败但未能保存关联」的补偿回滚，也用于用户确认后的会话删除；
    /// 目标必须由调用方依据本地记录解析出真实原生标识后传入，绝不猜测。
    fn delete(&self, ctx: &ToolContext, native_id: &str) -> Result<(), AppError>;

    /// 恢复前是否具备可靠的原生会话存在性查询能力。
    ///
    /// 为 false 时不进行预检，缺失判定完全交给工具自身（绝不静默新建）。
    fn can_verify_exists(&self, tool_id: &str) -> bool;

    /// 创建后首次进入新会话所需的启动参数（不含可执行文件本身）。
    fn create_launch_args(
        &self,
        ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError>;

    /// 恢复既有原生会话所需的启动参数（不含可执行文件本身）。
    fn restore_launch_args(
        &self,
        ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError>;
}

/// 使用真实工具进程 / HTTP 服务的后端实现。
#[derive(Debug, Default)]
pub struct SystemNativeBackend;

impl SystemNativeBackend {
    pub fn new() -> Self {
        Self
    }
}

impl NativeBackend for SystemNativeBackend {
    fn capabilities(&self, tool_id: &str) -> SessionCapabilities {
        capabilities_for(tool_id)
    }

    fn create(
        &self,
        ctx: &ToolContext,
        title: Option<&str>,
    ) -> Result<NativeSessionInfo, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::create(ctx, title),
            "claude-code" => claude::create(ctx, title),
            _ => Err(unsupported_capability("创建")),
        }
    }

    fn list(&self, ctx: &ToolContext) -> Result<Vec<NativeSessionInfo>, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::list(ctx),
            "opencode-desktop" => opencode_desktop::list(ctx),
            "claude-code" => claude::list(ctx),
            "cursor" => cursor::list(ctx),
            "trae" => trae::list(ctx),
            "trae-solo" => trae_solo::list(ctx),
            "workbuddy" => workbuddy::list(ctx),
            _ => Err(unsupported_capability("枚举")),
        }
    }

    fn list_with_state(&self, ctx: &ToolContext) -> Result<HistoryListing, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::list_with_state(ctx),
            "opencode-desktop" => opencode_desktop::list_with_state(ctx),
            "claude-code" => claude::list_with_state(ctx),
            "cursor" => cursor::list_with_state(ctx),
            "trae" => trae::list_with_state(ctx),
            "trae-solo" => trae_solo::list_with_state(ctx),
            "workbuddy" => workbuddy::list_with_state(ctx),
            _ => Err(unsupported_capability("枚举")),
        }
    }

    fn get(&self, ctx: &ToolContext, native_id: &str) -> Result<Option<NativeSessionInfo>, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::get(ctx, native_id),
            _ => Err(unsupported_capability("查询")),
        }
    }

    fn rename_title(&self, ctx: &ToolContext, native_id: &str, title: &str) -> Result<(), AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::rename_title(ctx, native_id, title),
            _ => Err(unsupported_capability("修改标题")),
        }
    }

    fn delete(&self, ctx: &ToolContext, native_id: &str) -> Result<(), AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => opencode::delete(ctx, native_id),
            _ => Err(unsupported_capability("删除")),
        }
    }

    fn can_verify_exists(&self, tool_id: &str) -> bool {
        matches!(tool_id, "opencode")
    }

    fn create_launch_args(
        &self,
        ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => Ok(opencode::create_launch_args(native_id)),
            "claude-code" => Ok(claude::create_launch_args(native_id)),
            _ => Err(unsupported_capability("创建")),
        }
    }

    fn restore_launch_args(
        &self,
        ctx: &ToolContext,
        native_id: &str,
    ) -> Result<Vec<String>, AppError> {
        match ctx.tool_id.as_str() {
            "opencode" => Ok(opencode::restore_launch_args(native_id)),
            "claude-code" => Ok(claude::restore_launch_args(native_id)),
            _ => Err(unsupported_capability("恢复")),
        }
    }
}

fn unsupported_capability(action: &str) -> AppError {
    AppError::new(
        "NATIVE_CAPABILITY_UNSUPPORTED",
        format!("当前工具不支持「{action}」原生会话操作。"),
    )
}

/// 构建工具上下文：校验项目目录存在、工具安装有效并取得可执行文件路径。
///
/// 在创建 / 枚举 / 恢复原生会话之前先确认项目目录存在且可访问，避免在无效目录下
/// 创建出无法追踪或指向错误位置的会话。
pub fn tool_context(
    conn: &Connection,
    detector: &dyn Detector,
    tool_install_id: &str,
    working_dir: &Path,
) -> Result<ToolContext, AppError> {
    let metadata = std::fs::metadata(working_dir).map_err(|_| {
        AppError::new(
            "PROJECT_PATH_MISSING",
            format!("项目目录不存在或不可访问：{}", working_dir.display()),
        )
    })?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "PROJECT_PATH_NOT_DIR",
            format!("项目路径不是目录：{}", working_dir.display()),
        ));
    }

    let state = tools::tool_state(conn, detector)?;
    let entry = state
        .entries
        .iter()
        .find(|entry| entry.id == tool_install_id)
        .ok_or_else(|| AppError::new("TOOL_NOT_FOUND", "未找到该开发工具配置，请重新选择。"))?;
    if !entry.installed {
        return Err(AppError::new("TOOL_NOT_READY", entry.launch.reason.clone()));
    }
    let executable = entry
        .executable_path
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("TOOL_CONFIG_REQUIRED", "该工具缺少可执行文件路径。"))?;
    Ok(ToolContext {
        tool_id: entry.tool_id.clone(),
        tool_name: entry.name.clone(),
        executable: PathBuf::from(executable),
        working_dir: working_dir.to_path_buf(),
    })
}

/// 创建原生会话的输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCreateInput {
    pub project_id: String,
    /// 工具安装 id（`tool_installations.id`）。
    pub tool_id: String,
    /// 显示名称 / 原生标题；为空时由工具自动生成。
    #[serde(default)]
    pub display_name: Option<String>,
    /// 创建成功后是否立即在工具中打开（默认 true）。
    #[serde(default = "default_true")]
    pub launch: bool,
}

fn default_true() -> bool {
    true
}

/// 创建原生会话的结果。会话记录已保存，但启动可能单独失败（如实报告）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCreateOutcome {
    pub session: Session,
    pub native: NativeSessionInfo,
    pub launch: Option<LaunchResult>,
    pub launch_error: Option<AppError>,
}

/// 重命名结果：是否同时修改了原生标题。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOutcome {
    pub session: Session,
    pub native_renamed: bool,
}

fn short_id(id: &str) -> String {
    id.chars().rev().take(6).collect::<String>().chars().rev().collect()
}

/// 创建原生会话并在成功后写入本地记录；若保存失败则回滚刚创建的原生会话。
pub fn create(
    conn: &Connection,
    backend: &dyn NativeBackend,
    launcher: &dyn ProcessLauncher,
    guard: &LaunchGuard,
    detector: &dyn Detector,
    input: NativeCreateInput,
) -> Result<NativeCreateOutcome, AppError> {
    let project = projects::get_project(conn, &input.project_id)?;
    let working_dir = PathBuf::from(&project.path);
    let ctx = tool_context(conn, detector, &input.tool_id, &working_dir)?;

    let caps = backend.capabilities(&ctx.tool_id);
    match caps.create {
        Support::Supported => {}
        Support::Unsupported => {
            return Err(AppError::new(
                "NATIVE_CREATE_UNSUPPORTED",
                format!("{} 不支持创建原生会话。", ctx.tool_name),
            ))
        }
        Support::NotVerified => {
            return Err(AppError::new(
                "NATIVE_CREATE_NOT_VERIFIED",
                format!(
                    "尚未核实 {} 的原生会话创建能力，已取消操作以免产生无法追踪的会话。",
                    ctx.tool_name
                ),
            ))
        }
    }

    let display_name = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    // 仅在工具真实返回标识后继续。
    let native = backend.create(&ctx, display_name.as_deref())?;

    let association = project_tools::ensure(conn, &project.id, &input.tool_id)?;
    let local_name = display_name
        .clone()
        .or_else(|| native.title.clone())
        .unwrap_or_else(|| format!("会话 {}", short_id(&native.native_id)));

    let session =
        match sessions::insert_native(conn, &association.id, &local_name, &native.native_id, None) {
            Ok(session) => session,
            Err(error) => {
                // 补偿：删除刚刚创建但未能保存关联的原生会话，避免留下孤儿会话。
                let _ = backend.delete(&ctx, &native.native_id);
                return Err(AppError::new(
                    "NATIVE_SESSION_PERSIST_FAILED",
                    format!(
                        "原生会话已创建（标识 {}），但保存关联失败，已尝试回滚：{}",
                        native.native_id, error.message
                    ),
                ));
            }
        };

    let (launch_result, launch_error) = if input.launch {
        match backend
            .create_launch_args(&ctx, &native.native_id)
            .and_then(|args| {
                launch::launch_with_args(
                    conn,
                    launcher,
                    guard,
                    &project.id,
                    Some(&input.tool_id),
                    &args,
                    detector,
                )
            }) {
            Ok(result) => {
                let _ = sessions::touch(conn, &session.id);
                (Some(result), None)
            }
            Err(error) => (None, Some(error)),
        }
    } else {
        (None, None)
    };

    Ok(NativeCreateOutcome {
        session,
        native,
        launch: launch_result,
        launch_error,
    })
}

/// 枚举当前项目目录下的原生会话（只读，不写入任何记录）。
pub fn list_native(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    project_id: &str,
    tool_install_id: &str,
) -> Result<Vec<NativeSessionInfo>, AppError> {
    Ok(list_native_with_state(conn, backend, detector, project_id, tool_install_id)?.items)
}

/// 带数据源状态的枚举：区分「有历史 / 没有历史 / 来源不存在 / 无法读取 / 结构不受支持」。
///
/// 能力不支持的工具仍如实报错（`NATIVE_LIST_UNSUPPORTED`），绝不声称查询成功。
pub fn list_native_with_state(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    project_id: &str,
    tool_install_id: &str,
) -> Result<HistoryListing, AppError> {
    let project = projects::get_project(conn, project_id)?;
    let ctx = tool_context(conn, detector, tool_install_id, Path::new(&project.path))?;
    if backend.capabilities(&ctx.tool_id).list != Support::Supported {
        return Err(AppError::new(
            "NATIVE_LIST_UNSUPPORTED",
            format!("{} 不支持枚举原生会话。", ctx.tool_name),
        ));
    }
    backend.list_with_state(&ctx)
}

/// 同步后的结果：本地会话列表 + 本次查询的数据源状态。
///
/// `state` 与 `sessions` 相互独立：来源不存在 / 无法读取时 `sessions` 为空，
/// 但状态如实反映原因，界面据此区分「没有历史」与「读取失败」。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub state: HistoryQueryState,
    pub sessions: Vec<Session>,
}

/// 将工具中的原生会话导入（幂等）为本地会话记录，并返回数据源状态与同步后的本地列表。
pub fn sync(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    project_id: &str,
    tool_install_id: &str,
) -> Result<SyncOutcome, AppError> {
    let listing = list_native_with_state(conn, backend, detector, project_id, tool_install_id)?;
    let association = project_tools::ensure(conn, project_id, tool_install_id)?;
    let mut sessions_out = Vec::with_capacity(listing.items.len());
    for native in &listing.items {
        let name = native
            .title
            .clone()
            .unwrap_or_else(|| format!("会话 {}", short_id(&native.native_id)));
        let session = sessions::upsert_native(conn, &association.id, &name, &native.native_id, None)?;
        sessions_out.push(session);
    }
    Ok(SyncOutcome {
        state: listing.state,
        sessions: sessions_out,
    })
}

/// 恢复本地记录所对应的原生会话；先确认其仍存在，绝不静默新建。
pub fn restore(
    conn: &Connection,
    backend: &dyn NativeBackend,
    launcher: &dyn ProcessLauncher,
    guard: &LaunchGuard,
    detector: &dyn Detector,
    session_id: &str,
) -> Result<LaunchResult, AppError> {
    let session = sessions::get(conn, session_id)?;
    let native_id = session.native_session_id.clone().ok_or_else(|| {
        AppError::new(
            "SESSION_NO_NATIVE_ID",
            "该会话没有原生会话标识，无法恢复原生会话；可改用「打开项目」在工具中继续。",
        )
    })?;

    let project = projects::get_project(conn, &session.project_id)?;
    let ctx = tool_context(conn, detector, &session.tool_id, Path::new(&project.path))?;
    if backend.capabilities(&ctx.tool_id).restore != Support::Supported {
        return Err(AppError::new(
            "NATIVE_RESTORE_UNSUPPORTED",
            format!("{} 不支持恢复指定原生会话。", ctx.tool_name),
        ));
    }

    // 仅在工具具备可靠的存在性查询能力时才预检；否则把缺失判定交给工具自身。
    if backend.can_verify_exists(&ctx.tool_id) {
        match backend.get(&ctx, &native_id)? {
            Some(_) => {}
            None => {
                return Err(AppError::new(
                    "NATIVE_SESSION_MISSING",
                    "对应的原生会话已不存在，请刷新历史会话列表。",
                ))
            }
        }
    }

    let args = backend.restore_launch_args(&ctx, &native_id)?;
    let result = launch::launch_with_args(
        conn,
        launcher,
        guard,
        &session.project_id,
        Some(&session.tool_id),
        &args,
        detector,
    )?;
    let _ = sessions::touch(conn, session_id);
    Ok(result)
}

/// 重命名会话：始终修改本地显示名；`sync_native` 为真时同时尝试修改原生标题。
///
/// 若工具不支持修改原生标题，则**不**进行本地重命名并如实报错，避免用户误以为
/// 原生标题已同步。
pub fn rename(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    session_id: &str,
    display_name: &str,
    sync_native: bool,
) -> Result<RenameOutcome, AppError> {
    let session = sessions::get(conn, session_id)?;
    let mut native_renamed = false;
    if sync_native {
        let native_id = session.native_session_id.clone().ok_or_else(|| {
            AppError::new(
                "SESSION_NO_NATIVE_ID",
                "该会话没有原生会话标识，无法同步修改原生标题。",
            )
        })?;
        let project = projects::get_project(conn, &session.project_id)?;
        let ctx = tool_context(conn, detector, &session.tool_id, Path::new(&project.path))?;
        if backend.capabilities(&ctx.tool_id).rename_title != Support::Supported {
            return Err(AppError::new(
                "NATIVE_RENAME_UNSUPPORTED",
                format!(
                    "{} 不支持修改原生会话标题，仅可修改本地显示名称。",
                    ctx.tool_name
                ),
            ));
        }
        backend.rename_title(&ctx, &native_id, display_name)?;
        native_renamed = true;
    }
    let updated = sessions::rename(conn, session_id, display_name)?;
    Ok(RenameOutcome {
        session: updated,
        native_renamed,
    })
}

/// 删除范围：明确决定删除 VibeAcross 本地记录、AI 工具中的原生会话，或两者。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeleteScope {
    /// 仅删除 VibeAcross 中的本地会话记录，不动工具中的原生会话。
    Local,
    /// 仅删除工具中的原生会话，保留 VibeAcross 本地记录。
    Native,
    /// 先删除工具中的原生会话，成功后再清理本地记录。
    Both,
}

/// 仅删除原生会话的结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeleteOutcome {
    /// 是否已确认原生会话被删除（包含原本就不存在的情况）。
    pub native_deleted: bool,
    /// 删除前工具中就已不存在该原生会话（此前已在外部被删除）。
    pub native_already_gone: bool,
}

/// 删除会话的结果：如实反映本次实际删除的范围。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub scope: DeleteScope,
    /// 原生会话是否已删除（仅当范围包含原生删除时可能为真）。
    pub native_deleted: bool,
    /// 删除前工具中就已不存在该原生会话。
    pub native_already_gone: bool,
    /// VibeAcross 本地记录是否已清理。
    pub local_deleted: bool,
}

/// 仅删除工具中的原生会话，保留 VibeAcross 本地记录。
///
/// 约束：
///  - 仅在工具**已核实**支持删除原生会话时才执行；不支持 / 未核实一律如实报错，
///    绝不伪造删除能力；
///  - 目标由本地记录解析出真实原生会话标识，并重新核对其所属项目 / 工具 / 目录；
///  - 删除失败直接返回错误，绝不触碰本地记录。
pub fn delete_native_only(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    session_id: &str,
) -> Result<NativeDeleteOutcome, AppError> {
    let session = sessions::get(conn, session_id)?;
    let native_id = session.native_session_id.clone().ok_or_else(|| {
        AppError::new(
            "SESSION_NO_NATIVE_ID",
            "该会话没有原生会话标识，无法删除工具中的会话。",
        )
    })?;

    let project = projects::get_project(conn, &session.project_id)?;
    let ctx = tool_context(conn, detector, &session.tool_id, Path::new(&project.path))?;
    match backend.capabilities(&ctx.tool_id).delete {
        Support::Supported => {}
        Support::Unsupported => {
            return Err(AppError::new(
                "NATIVE_DELETE_UNSUPPORTED",
                format!(
                    "{} 不支持删除原生会话，已取消操作；工具中的会话保持不变。",
                    ctx.tool_name
                ),
            ))
        }
        Support::NotVerified => {
            return Err(AppError::new(
                "NATIVE_DELETE_NOT_VERIFIED",
                format!(
                    "尚未核实 {} 的原生会话删除能力，已取消操作以免误删。",
                    ctx.tool_name
                ),
            ))
        }
    }

    // 仅在具备可靠存在性查询能力时预检：既能确认「已不存在」，也能避免删除目标错位
    // （查询按项目目录过滤，命中不了就不会误删其它目录下的会话）。
    let native_already_gone = if backend.can_verify_exists(&ctx.tool_id) {
        backend.get(&ctx, &native_id)?.is_none()
    } else {
        false
    };

    if !native_already_gone {
        backend.delete(&ctx, &native_id)?;
    }

    Ok(NativeDeleteOutcome {
        native_deleted: true,
        native_already_gone,
    })
}

/// 按照选定范围删除会话，协调原生删除与本地清理的执行顺序及错误处理。
///
/// 严格区分两类数据：
///  - `Local`：只清理本地记录，**绝不**调用任何原生删除操作；
///  - `Native`：只删除原生会话，**绝不**清理本地记录；
///  - `Both`：先成功删除原生会话，再清理本地记录；原生删除失败则保留本地记录。
pub fn delete_session(
    conn: &Connection,
    backend: &dyn NativeBackend,
    detector: &dyn Detector,
    session_id: &str,
    scope: DeleteScope,
) -> Result<DeleteOutcome, AppError> {
    // 先确认记录存在，避免对不存在的记录执行任何删除。
    sessions::get(conn, session_id)?;

    match scope {
        DeleteScope::Local => {
            sessions::delete(conn, session_id)?;
            Ok(DeleteOutcome {
                scope,
                native_deleted: false,
                native_already_gone: false,
                local_deleted: true,
            })
        }
        DeleteScope::Native => {
            let native = delete_native_only(conn, backend, detector, session_id)?;
            Ok(DeleteOutcome {
                scope,
                native_deleted: native.native_deleted,
                native_already_gone: native.native_already_gone,
                local_deleted: false,
            })
        }
        DeleteScope::Both => {
            // 顺序：必须先成功删除原生会话，再清理本地记录；原生失败直接返回，
            // 本地记录保持不变。
            let native = delete_native_only(conn, backend, detector, session_id)?;
            sessions::delete(conn, session_id).map_err(|error| {
                AppError::new(
                    "NATIVE_DELETE_LOCAL_CLEANUP_FAILED",
                    format!(
                        "工具中的原生会话已删除，但清理 VibeAcross 本地记录失败：{} 请重试删除以清理该记录。",
                        error.message
                    ),
                )
            })?;
            Ok(DeleteOutcome {
                scope,
                native_deleted: native.native_deleted,
                native_already_gone: native.native_already_gone,
                local_deleted: true,
            })
        }
    }
}
