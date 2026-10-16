use crate::error::AppError;
use crate::settings::{read_setting, write_setting, KEY_TOOLS_LAST_DETECTION};
use crate::tools::catalog::{self, LaunchPlan, RestorePlan, SessionResumePlan, ToolDefinition};
use crate::tools::detect::{detect_definition, Detector, VersionOutcome};
use crate::tools::model::{
    LaunchMethod, LaunchSupport, RestoreLevel, SessionResumeSupport, ToolConfigInput, ToolEntry,
    ToolLaunchInfo, ToolRestoreInfo, ToolState, ToolStatus, ToolType,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const SOURCE_AUTO: &str = "auto";
const SOURCE_MANUAL: &str = "manual";
const SOURCE_BUILTIN: &str = "builtin";

const SELECT_COLUMNS: &str = "id, tool_id, name, vendor, description, tool_type, source, \
     executable_path, command_name, version, status, detection_method, is_custom, is_default, \
     detected_at, last_error, created_at, updated_at";

/// 数据库中的一条安装记录。
#[derive(Debug, Clone)]
struct InstallRow {
    id: String,
    tool_id: String,
    name: String,
    vendor: String,
    description: String,
    tool_type: ToolType,
    source: String,
    executable_path: Option<String>,
    command_name: Option<String>,
    version: Option<String>,
    status: ToolStatus,
    detection_method: Option<String>,
    is_custom: bool,
    is_default: bool,
    detected_at: Option<String>,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

fn row_to_install(row: &rusqlite::Row<'_>) -> rusqlite::Result<InstallRow> {
    let tool_type: String = row.get("tool_type")?;
    let status: String = row.get("status")?;
    Ok(InstallRow {
        id: row.get("id")?,
        tool_id: row.get("tool_id")?,
        name: row.get("name")?,
        vendor: row.get("vendor")?,
        description: row.get("description")?,
        tool_type: ToolType::from_str(&tool_type).unwrap_or(ToolType::Cli),
        source: row.get("source")?,
        executable_path: row.get("executable_path")?,
        command_name: row.get("command_name")?,
        version: row.get("version")?,
        status: ToolStatus::from_str(&status),
        detection_method: row.get("detection_method")?,
        is_custom: row.get::<_, i64>("is_custom")? != 0,
        is_default: row.get::<_, i64>("is_default")? != 0,
        detected_at: row.get("detected_at")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn load_installs(conn: &Connection) -> Result<Vec<InstallRow>, AppError> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM tool_installations");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], row_to_install)?;
    let mut installs = Vec::new();
    for row in rows {
        installs.push(row?);
    }
    Ok(installs)
}

fn load_installs_for_tool(conn: &Connection, tool_id: &str) -> Result<Vec<InstallRow>, AppError> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM tool_installations WHERE tool_id = ?1");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([tool_id], row_to_install)?;
    let mut installs = Vec::new();
    for row in rows {
        installs.push(row?);
    }
    Ok(installs)
}

fn install_to_entry(install: &InstallRow) -> ToolEntry {
    let definition = catalog::find(&install.tool_id);
    let launch = launch_info(
        definition,
        install.tool_type,
        install.status,
        install.is_custom,
        install.executable_path.as_deref(),
    );
    let restore = restore_info(definition, &launch, install.is_custom);
    ToolEntry {
        id: install.id.clone(),
        tool_id: install.tool_id.clone(),
        name: install.name.clone(),
        vendor: install.vendor.clone(),
        description: install.description.clone(),
        tool_type: install.tool_type,
        source: install.source.clone(),
        status: install.status,
        executable_path: install.executable_path.clone(),
        command_name: install.command_name.clone(),
        version: install.version.clone(),
        detection_method: install.detection_method.clone(),
        is_custom: install.is_custom,
        is_default: install.is_default,
        detected_at: install.detected_at.clone(),
        last_error: install.last_error.clone(),
        created_at: Some(install.created_at.clone()),
        updated_at: Some(install.updated_at.clone()),
        auto_detect_reliable: definition
            .map(|definition| definition.auto_detect_reliable)
            .unwrap_or(true),
        detection_note: definition
            .map(|definition| definition.detection_note.to_string())
            .unwrap_or_else(|| "用户手动添加的工具。".to_string()),
        launch,
        restore,
        installed: install.status == ToolStatus::Detected,
    }
}

fn placeholder_entry(definition: &ToolDefinition, status: ToolStatus) -> ToolEntry {
    let launch = launch_info(Some(definition), definition.tool_type, status, false, None);
    let restore = restore_info(Some(definition), &launch, false);
    ToolEntry {
        id: format!("catalog:{}", definition.id),
        tool_id: definition.id.to_string(),
        name: definition.name.to_string(),
        vendor: definition.vendor.to_string(),
        description: definition.description.to_string(),
        tool_type: definition.tool_type,
        source: SOURCE_BUILTIN.to_string(),
        status,
        executable_path: None,
        command_name: definition.commands.first().map(|value| value.to_string()),
        version: None,
        detection_method: None,
        is_custom: false,
        is_default: false,
        detected_at: None,
        last_error: None,
        created_at: None,
        updated_at: None,
        auto_detect_reliable: definition.auto_detect_reliable,
        detection_note: definition.detection_note.to_string(),
        launch,
        restore,
        installed: false,
    }
}

/// 计算工具的受控启动能力。
///
/// 只有「已检测到」且启动方式明确、可安全执行的安装才标记为 `Supported`；
/// 其余情况给出可操作的原因，避免前端误以为可以启动。
fn launch_info(
    definition: Option<&ToolDefinition>,
    tool_type: ToolType,
    status: ToolStatus,
    is_custom: bool,
    executable_path: Option<&str>,
) -> ToolLaunchInfo {
    if status != ToolStatus::Detected {
        return ToolLaunchInfo {
            support: LaunchSupport::Unavailable,
            method: None,
            reason: status_reason(status),
        };
    }

    let plan = match definition {
        Some(found) => found.launch_plan,
        None if is_custom && tool_type == ToolType::Cli => {
            LaunchPlan::Method(LaunchMethod::WorkingDirectory)
        }
        None => LaunchPlan::Unsupported("自定义桌面应用的启动参数未知，暂不支持受控启动。"),
    };

    let method = match plan {
        LaunchPlan::Unsupported(reason) => {
            return ToolLaunchInfo {
                support: LaunchSupport::Unsupported,
                method: None,
                reason: reason.to_string(),
            };
        }
        LaunchPlan::Method(method) => method,
    };

    match executable_path.map(str::trim).filter(|value| !value.is_empty()) {
        None => ToolLaunchInfo {
            support: LaunchSupport::NeedsConfiguration,
            method: None,
            reason: "缺少可执行文件路径，请在 Tools 页面补充配置。".to_string(),
        },
        Some(executable) if is_script(executable) => ToolLaunchInfo {
            support: LaunchSupport::NeedsConfiguration,
            method: None,
            reason: "该安装为脚本（.cmd/.bat），需要 shell 中间层；出于安全考虑不支持受控启动，请配置 .exe 形式。".to_string(),
        },
        Some(_) => ToolLaunchInfo {
            support: LaunchSupport::Supported,
            method: Some(method),
            reason: match method {
                LaunchMethod::FolderArgument => {
                    "将以项目目录作为参数打开该应用。".to_string()
                }
                LaunchMethod::WorkingDirectory => {
                    "将在项目目录中以新的控制台窗口启动该命令行工具。".to_string()
                }
            },
        },
    }
}

fn status_reason(status: ToolStatus) -> String {
    match status {
        ToolStatus::Detected => "工具可用。",
        ToolStatus::NotDetected => "尚未检测到可用安装。",
        ToolStatus::NotInstalled => "本机未检测到该工具。",
        ToolStatus::PathMissing => "已配置的可执行文件不存在，请重新配置。",
        ToolStatus::Unverified => "无法验证该工具的可执行文件，请重新配置。",
        ToolStatus::DetectionFailed => "检测失败，请重新检测。",
    }
    .to_string()
}

/// 计算工具的工作上下文恢复能力。
///
/// Level 1 依赖受控启动：只有可启动的工具才能恢复项目与工作目录。会话恢复
/// （Level 2/3）依据官方文档如实标注为「未验证」或「不支持」，绝不臆造能力。
fn restore_info(
    definition: Option<&ToolDefinition>,
    launch: &ToolLaunchInfo,
    is_custom: bool,
) -> ToolRestoreInfo {
    let (level, level_reason) = if launch.support == LaunchSupport::Supported {
        match definition.map(|found| found.restore_plan) {
            Some(RestorePlan::Unsupported(reason)) => (RestoreLevel::None, reason.to_string()),
            // 内置可启动工具与自定义 CLI 工具都支持恢复项目（Level 1）。
            _ if is_custom || definition.is_some() => (
                RestoreLevel::Project,
                "可恢复项目、工作目录与所选开发工具（Level 1）。".to_string(),
            ),
            _ => (
                RestoreLevel::None,
                "该工具当前不支持受控恢复。".to_string(),
            ),
        }
    } else {
        (
            RestoreLevel::None,
            format!("当前不可恢复：{}", launch.reason),
        )
    };

    let (session, session_reason) = match definition.map(|found| found.session_resume) {
        Some(SessionResumePlan::DocumentedUnverified(note)) => {
            (SessionResumeSupport::DocumentedUnverified, note.to_string())
        }
        Some(SessionResumePlan::Unsupported(note)) => {
            (SessionResumeSupport::Unsupported, note.to_string())
        }
        None => (
            SessionResumeSupport::Unsupported,
            "自定义工具没有已知的公开会话恢复机制，仅支持重新打开项目。".to_string(),
        ),
    };

    ToolRestoreInfo {
        level,
        level_reason,
        session,
        session_reason,
    }
}

/// 判断路径是否为需要 shell 才能执行的脚本。
fn is_script(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("cmd") | Some("bat")
    )
}

fn order_key(entry: &ToolEntry) -> (usize, bool) {
    let index = catalog::index_of(&entry.tool_id).unwrap_or(usize::MAX);
    (index, entry.is_default)
}

fn sort_entries(entries: &mut [ToolEntry]) {
    entries.sort_by(|a, b| {
        let (index_a, default_a) = order_key(a);
        let (index_b, default_b) = order_key(b);
        index_a
            .cmp(&index_b)
            // 默认工具优先展示。
            .then_with(|| default_b.cmp(&default_a))
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// 清除状态已不可用的默认工具标记，保证「默认工具」始终可用。
pub fn sanitize_default(conn: &Connection) -> Result<(), AppError> {
    conn.execute(
        "UPDATE tool_installations SET is_default = 0 WHERE is_default = 1 AND status <> ?1",
        [ToolStatus::Detected.as_str()],
    )?;
    Ok(())
}

/// 组装完整工具状态：持久化记录 + 内置占位条目。
pub fn tool_state(conn: &Connection, _detector: &dyn Detector) -> Result<ToolState, AppError> {
    sanitize_default(conn)?;

    let installs = load_installs(conn)?;
    let last_detection_at = read_setting(conn, KEY_TOOLS_LAST_DETECTION)?;

    let mut entries: Vec<ToolEntry> = installs.iter().map(install_to_entry).collect();

    for definition in catalog::all() {
        if installs.iter().any(|install| install.tool_id == definition.id) {
            continue;
        }
        // 仅在具备可靠检测方式且已执行过全量检测时才报告「未安装」。
        let status = if definition.auto_detect_reliable && last_detection_at.is_some() {
            ToolStatus::NotInstalled
        } else {
            ToolStatus::NotDetected
        };
        entries.push(placeholder_entry(definition, status));
    }

    sort_entries(&mut entries);
    Ok(ToolState {
        entries,
        last_detection_at,
    })
}

fn compare_key(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    clean_path(trimmed).replace('/', "\\").to_ascii_lowercase()
}

fn canonical_file(raw: &str) -> String {
    match std::fs::canonicalize(raw) {
        Ok(path) => clean_path(&path.to_string_lossy()),
        Err(_) => raw.trim().to_string(),
    }
}

/// 去除 Windows `\\?\` 扩展长度前缀，得到可读路径。
fn clean_path(path: &str) -> String {
    path.strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| path.strip_prefix(r"\\?\").map(str::to_string))
        .unwrap_or_else(|| path.to_string())
}

fn path_exists(conn_path: Option<&str>, other: &Path) -> bool {
    match conn_path {
        Some(value) => compare_key(value) == compare_key(&other.to_string_lossy()),
        None => false,
    }
}

enum FieldAction {
    Set(String),
    Clear,
    Retain,
}

fn field_action(raw: &Option<String>) -> FieldAction {
    match raw {
        None => FieldAction::Retain,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                FieldAction::Clear
            } else {
                FieldAction::Set(trimmed.to_string())
            }
        }
    }
}

struct ResolvedConfig {
    tool_id: String,
    name: String,
    vendor: String,
    description: String,
    tool_type: ToolType,
    is_custom: bool,
    source: String,
    executable_path: Option<String>,
    command_name: Option<String>,
    version: Option<String>,
    status: ToolStatus,
    detection_method: Option<String>,
    last_error: Option<String>,
}

fn resolve_config(
    detector: &dyn Detector,
    input: &ToolConfigInput,
    existing: Option<&InstallRow>,
    is_update: bool,
) -> Result<ResolvedConfig, AppError> {
    let definition = match existing {
        Some(row) => catalog::find(&row.tool_id),
        None => match input.tool_id.as_deref() {
            Some(id) if !id.trim().is_empty() => Some(
                catalog::find(id.trim())
                    .ok_or_else(|| AppError::new("TOOL_UNKNOWN", "未知的工具标识。"))?,
            ),
            _ => None,
        },
    };

    let tool_id = match existing {
        Some(row) => row.tool_id.clone(),
        None => match definition {
            Some(found) => found.id.to_string(),
            None => format!("custom:{}", uuid::Uuid::new_v4()),
        },
    };

    let name_provided = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let name = match (name_provided, definition, existing) {
        (Some(value), _, _) => value.to_string(),
        (None, Some(found), _) => found.name.to_string(),
        (None, None, Some(row)) => row.name.clone(),
        (None, None, None) => {
            return Err(AppError::new("TOOL_NAME_EMPTY", "请填写工具名称。"));
        }
    };

    let (vendor, description, is_custom) = match definition {
        Some(found) => (
            found.vendor.to_string(),
            found.description.to_string(),
            false,
        ),
        None => (
            "自定义".to_string(),
            "用户手动添加的工具。".to_string(),
            true,
        ),
    };

    let tool_type = match (definition, input.tool_type, existing) {
        (Some(found), _, _) => found.tool_type,
        (None, Some(value), _) => value,
        (None, None, Some(row)) => row.tool_type,
        (None, None, None) => {
            return Err(AppError::new("TOOL_TYPE_REQUIRED", "请选择工具类型。"));
        }
    };

    let action_path = field_action(&input.executable_path);
    let action_command = field_action(&input.command_name);

    // 新增时缺省视为清空；编辑时缺省视为保留原值。
    let path = match (&action_path, existing) {
        (FieldAction::Set(value), _) => Some(value.clone()),
        (FieldAction::Clear, _) => None,
        (FieldAction::Retain, Some(row)) => row.executable_path.clone(),
        (FieldAction::Retain, None) => None,
    };
    let command = match (&action_command, existing) {
        (FieldAction::Set(value), _) => Some(value.clone()),
        (FieldAction::Clear, _) => None,
        (FieldAction::Retain, Some(row)) => row.command_name.clone(),
        (FieldAction::Retain, None) => None,
    };

    if path.is_none() && command.is_none() {
        return Err(AppError::new(
            "TOOL_CONFIG_REQUIRED",
            "请提供可执行文件路径或命令名称。",
        ));
    }

    let mut status = ToolStatus::Unverified;
    let mut resolved_path = path.clone();
    let mut effective_command = command.clone();
    let mut version = None;
    let mut detection_method = None;
    let mut last_error = None;

    if let Some(raw_path) = path.as_deref() {
        match detector.file_exists(Path::new(raw_path)) {
            Ok(true) => {
                resolved_path = Some(canonical_file(raw_path));
                status = ToolStatus::Detected;
                detection_method = Some("手动指定路径".to_string());
                if let Some(found) = definition {
                    version = query_definition_version(detector, found, raw_path);
                }
            }
            Ok(false) => {
                status = ToolStatus::PathMissing;
                last_error = Some("配置的可执行文件不存在。".to_string());
            }
            Err(error) => {
                status = ToolStatus::DetectionFailed;
                last_error = Some(error.message);
            }
        }
    } else if let Some(command_name) = command.as_deref() {
        match detector.resolve_command(command_name) {
            Some(resolved) => {
                resolved_path = Some(clean_path(&resolved.to_string_lossy()));
                status = ToolStatus::Detected;
                detection_method = Some(format!("PATH 命令 `{command_name}`"));
            }
            None => {
                status = ToolStatus::Unverified;
                last_error = Some(format!("未能在 PATH 中解析命令 `{command_name}`。"));
            }
        }
        effective_command = Some(command_name.to_string());
    }

    if status != ToolStatus::Detected {
        version = None;
    }

    Ok(ResolvedConfig {
        tool_id,
        name,
        vendor,
        description,
        tool_type,
        is_custom,
        source: if is_update {
            existing
                .map(|row| row.source.clone())
                .unwrap_or_else(|| SOURCE_MANUAL.to_string())
        } else {
            SOURCE_MANUAL.to_string()
        },
        executable_path: resolved_path,
        command_name: effective_command,
        version,
        status,
        detection_method,
        last_error,
    })
}

fn query_definition_version(
    detector: &dyn Detector,
    definition: &ToolDefinition,
    executable: &str,
) -> Option<String> {
    if definition.version_args.is_empty() {
        return None;
    }
    match detector.query_version(Path::new(executable), definition.version_args) {
        VersionOutcome::Value(value) => Some(value),
        _ => None,
    }
}

fn ensure_unique(
    conn: &Connection,
    tool_id: &str,
    executable_path: Option<&str>,
    command_name: Option<&str>,
    exclude_id: Option<&str>,
) -> Result<(), AppError> {
    let path_key = executable_path.map(compare_key).unwrap_or_default();
    let command_key = command_name
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();

    let installs = load_installs_for_tool(conn, tool_id)?;
    for row in installs {
        if Some(row.id.as_str()) == exclude_id {
            continue;
        }
        let row_path = row.executable_path.as_deref().map(compare_key).unwrap_or_default();
        let row_command = row
            .command_name
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();
        if row_path == path_key && row_command == command_key {
            return Err(AppError::new(
                "TOOL_DUPLICATE",
                "该工具已存在相同的路径或命令配置。",
            ));
        }
    }
    Ok(())
}

/// 新增一条工具配置（内置工具或自定义工具）。
pub fn add_tool(
    conn: &Connection,
    detector: &dyn Detector,
    input: ToolConfigInput,
) -> Result<(), AppError> {
    let config = resolve_config(detector, &input, None, false)?;
    ensure_unique(
        conn,
        &config.tool_id,
        config.executable_path.as_deref(),
        config.command_name.as_deref(),
        None,
    )?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();
    let detected_at = (config.status == ToolStatus::Detected).then(|| now.clone());

    conn.execute(
        "INSERT INTO tool_installations
            (id, tool_id, name, vendor, description, tool_type, source, executable_path,
             command_name, version, status, detection_method, is_custom, is_default,
             detected_at, last_error, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, ?15, ?16, ?16)",
        params![
            id,
            config.tool_id,
            config.name,
            config.vendor,
            config.description,
            config.tool_type.as_str(),
            config.source,
            config.executable_path,
            config.command_name,
            config.version,
            config.status.as_str(),
            config.detection_method,
            if config.is_custom { 1 } else { 0 },
            detected_at,
            config.last_error,
            now,
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::new("TOOL_DUPLICATE", "该工具已存在相同的路径或命令配置。")
        }
        other => other.into(),
    })?;

    Ok(())
}

/// 更新一条已有的工具配置。
pub fn update_tool(
    conn: &Connection,
    detector: &dyn Detector,
    id: &str,
    input: ToolConfigInput,
) -> Result<(), AppError> {
    let existing = load_installs(conn)?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or_else(|| AppError::new("TOOL_NOT_FOUND", "未找到该工具配置。"))?;

    let config = resolve_config(detector, &input, Some(&existing), true)?;
    ensure_unique(
        conn,
        &config.tool_id,
        config.executable_path.as_deref(),
        config.command_name.as_deref(),
        Some(id),
    )?;

    let now = crate::now_iso();
    let detected_at = if config.status == ToolStatus::Detected {
        Some(existing.detected_at.clone().unwrap_or_else(|| now.clone()))
    } else {
        existing.detected_at.clone()
    };
    let is_default = if config.status == ToolStatus::Detected {
        existing.is_default
    } else {
        false
    };

    conn.execute(
        "UPDATE tool_installations SET
            name = ?1, vendor = ?2, description = ?3, tool_type = ?4, executable_path = ?5,
            command_name = ?6, version = ?7, status = ?8, detection_method = ?9, is_custom = ?10,
            is_default = ?11, detected_at = ?12, last_error = ?13, updated_at = ?14
         WHERE id = ?15",
        params![
            config.name,
            config.vendor,
            config.description,
            config.tool_type.as_str(),
            config.executable_path,
            config.command_name,
            config.version,
            config.status.as_str(),
            config.detection_method,
            if config.is_custom { 1 } else { 0 },
            if is_default { 1 } else { 0 },
            detected_at,
            config.last_error,
            now,
            id,
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::new("TOOL_DUPLICATE", "该工具已存在相同的路径或命令配置。")
        }
        other => other.into(),
    })?;

    Ok(())
}

pub fn remove_tool(conn: &Connection, id: &str) -> Result<(), AppError> {
    let affected = conn.execute("DELETE FROM tool_installations WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new("TOOL_NOT_FOUND", "未找到该工具配置。"));
    }
    Ok(())
}

/// 设置/清除默认工具。仅「已检测到」的配置可以成为默认工具。
pub fn set_default_tool(conn: &Connection, id: Option<&str>) -> Result<(), AppError> {
    let transaction = conn.unchecked_transaction()?;
    transaction.execute("UPDATE tool_installations SET is_default = 0 WHERE is_default = 1", [])?;

    if let Some(target) = id {
        let status: Option<String> = transaction
            .query_row(
                "SELECT status FROM tool_installations WHERE id = ?1",
                [target],
                |row| row.get(0),
            )
            .optional()?;

        let status = status
            .ok_or_else(|| AppError::new("TOOL_NOT_FOUND", "未找到该工具配置。"))?;
        if status != ToolStatus::Detected.as_str() {
            return Err(AppError::new(
                "TOOL_NOT_READY",
                "仅可将已检测到且可用的工具设为默认。",
            ));
        }

        let now = crate::now_iso();
        transaction.execute(
            "UPDATE tool_installations SET is_default = 1, updated_at = ?1 WHERE id = ?2",
            params![now, target],
        )?;
    }

    transaction.commit()?;
    Ok(())
}

fn set_row_status(
    conn: &Connection,
    id: &str,
    status: ToolStatus,
    version: Option<String>,
    method: Option<String>,
    error: Option<String>,
) -> Result<(), AppError> {
    let now = crate::now_iso();
    let detected_at = (status == ToolStatus::Detected).then(|| now.clone());
    conn.execute(
        "UPDATE tool_installations SET
            status = ?1,
            version = COALESCE(?2, version),
            detection_method = COALESCE(?3, detection_method),
            last_error = ?4,
            detected_at = COALESCE(?5, detected_at),
            updated_at = ?6
         WHERE id = ?7",
        params![
            status.as_str(),
            version,
            method,
            error,
            detected_at,
            now,
            id,
        ],
    )?;
    Ok(())
}

fn revalidate_row(
    conn: &Connection,
    detector: &dyn Detector,
    row: &InstallRow,
    definition: Option<&ToolDefinition>,
) -> Result<(), AppError> {
    if let Some(path) = row.executable_path.as_deref() {
        match detector.file_exists(Path::new(path)) {
            Ok(true) => {
                let version = definition
                    .and_then(|found| query_definition_version(detector, found, path));
                set_row_status(
                    conn,
                    &row.id,
                    ToolStatus::Detected,
                    version,
                    Some("路径复核".to_string()),
                    None,
                )?;
            }
            Ok(false) => {
                set_row_status(
                    conn,
                    &row.id,
                    ToolStatus::PathMissing,
                    None,
                    None,
                    Some("配置的可执行文件不存在。".to_string()),
                )?;
            }
            Err(error) => {
                set_row_status(
                    conn,
                    &row.id,
                    ToolStatus::DetectionFailed,
                    None,
                    None,
                    Some(error.message),
                )?;
            }
        }
    } else if let Some(command) = row.command_name.as_deref() {
        match detector.resolve_command(command) {
            Some(_) => {
                set_row_status(
                    conn,
                    &row.id,
                    ToolStatus::Detected,
                    None,
                    Some(format!("PATH 命令 `{command}`")),
                    None,
                )?;
            }
            None => {
                set_row_status(
                    conn,
                    &row.id,
                    ToolStatus::Unverified,
                    None,
                    None,
                    Some(format!("未能在 PATH 中解析命令 `{command}`。")),
                )?;
            }
        }
    }
    Ok(())
}

fn detect_one(
    conn: &Connection,
    detector: &dyn Detector,
    definition: &ToolDefinition,
) -> Result<(), AppError> {
    let existing = load_installs_for_tool(conn, definition.id)?;

    for row in &existing {
        if row.executable_path.is_none() && row.command_name.is_none() {
            // 之前的「检测失败」占位记录，待本轮检测结果决定去留。
            continue;
        }
        revalidate_row(conn, detector, row, Some(definition))?;
    }

    let found = detect_definition(definition, detector);

    // 清理已不再需要的占位失败记录（本轮检测成功执行）。
    if found.is_ok() {
        for row in &existing {
            if row.executable_path.is_none() && row.command_name.is_none() {
                conn.execute("DELETE FROM tool_installations WHERE id = ?1", [&row.id])?;
            }
        }
    }

    match found {
        Ok(Some(found_tool)) => {
            let already = existing
                .iter()
                .any(|row| path_exists(row.executable_path.as_deref(), &found_tool.path));
            if !already {
                let reusable = existing
                    .iter()
                    .find(|row| row.executable_path.is_none() && row.command_name.is_none())
                    .or_else(|| {
                        existing.iter().find(|row| {
                            row.source == SOURCE_AUTO
                                && row.status == ToolStatus::PathMissing
                                && row.executable_path.is_some()
                        })
                    });

                let now = crate::now_iso();
                let path = clean_path(&found_tool.path.to_string_lossy());
                let warning = found_tool.warning.clone();

                match reusable {
                    Some(row) => {
                        conn.execute(
                            "UPDATE tool_installations SET
                                executable_path = ?1, version = ?2, status = ?3,
                                detection_method = ?4, last_error = ?5, detected_at = ?6,
                                updated_at = ?6, is_custom = 0, source = ?7
                             WHERE id = ?8",
                            params![
                                path,
                                found_tool.version,
                                ToolStatus::Detected.as_str(),
                                found_tool.method,
                                warning,
                                now,
                                SOURCE_AUTO,
                                row.id,
                            ],
                        )?;
                    }
                    None => {
                        let id = uuid::Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO tool_installations
                                (id, tool_id, name, vendor, description, tool_type, source,
                                 executable_path, command_name, version, status, detection_method,
                                 is_custom, is_default, detected_at, last_error, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, 0, 0, ?12, ?13, ?12, ?12)",
                            params![
                                id,
                                definition.id,
                                definition.name,
                                definition.vendor,
                                definition.description,
                                definition.tool_type.as_str(),
                                SOURCE_AUTO,
                                path,
                                found_tool.version,
                                ToolStatus::Detected.as_str(),
                                found_tool.method,
                                now,
                                warning,
                            ],
                        )?;
                    }
                }
            }
        }
        Ok(None) => {}
        Err(error) => {
            if existing.is_empty() {
                let id = uuid::Uuid::new_v4().to_string();
                let now = crate::now_iso();
                conn.execute(
                    "INSERT INTO tool_installations
                        (id, tool_id, name, vendor, description, tool_type, source,
                         executable_path, command_name, version, status, detection_method,
                         is_custom, is_default, detected_at, last_error, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, NULL, ?8, NULL, 0, 0, NULL, ?9, ?10, ?10)",
                    params![
                        id,
                        definition.id,
                        definition.name,
                        definition.vendor,
                        definition.description,
                        definition.tool_type.as_str(),
                        SOURCE_AUTO,
                        ToolStatus::DetectionFailed.as_str(),
                        error.message,
                        now,
                    ],
                )?;
            }
        }
    }

    Ok(())
}

/// 执行检测。`tool_id` 为 None 时进行全量检测并更新「最近检测时间」；
/// 指定单个工具时不改变全量检测标记。
pub fn detect_tools(
    conn: &Connection,
    detector: &dyn Detector,
    tool_id: Option<&str>,
) -> Result<ToolState, AppError> {
    match tool_id {
        Some(id) => {
            let definition = catalog::find(id)
                .ok_or_else(|| AppError::new("TOOL_UNKNOWN", "未知的工具标识。"))?;
            detect_one(conn, detector, definition)?;
        }
        None => {
            for definition in catalog::all() {
                detect_one(conn, detector, definition)?;
            }
            let now = crate::now_iso();
            write_setting(conn, KEY_TOOLS_LAST_DETECTION, Some(&now))?;
        }
    }

    tool_state(conn, detector)
}

/// 解析命令名（用于前端预览）到实际可执行文件路径。
pub fn resolve_command(detector: &dyn Detector, command: &str) -> Option<String> {
    detector
        .resolve_command(command.trim())
        .map(|path| clean_path(&path.to_string_lossy()))
}

/// 读取一条工具安装配置的显示名称（供活动记录等使用）。
pub fn install_name(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT name FROM tool_installations WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}
