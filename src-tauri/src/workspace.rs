//! 工作上下文（Phase 7）。
//!
//! 保存「项目 + 开发工具 + 任务」的组合快照，用于之后一键恢复工作环境。
//! 恢复复用 Phase 5 的受控启动逻辑；本阶段只实现 Level 1（恢复项目与工作目录），
//! 绝不臆造会话恢复参数，也不保存会话标识、完整对话或敏感信息。
//!
//! 数据一致性：
//!  - 删除项目时由 `projects::remove_project` 一并删除其工作上下文；
//!  - 删除任务时把 `task_id` 置空（上下文仍可用）；
//!  - 删除工具时把 `tool_id` 置空（上下文退化为需要重新选择工具）。

use crate::error::AppError;
use crate::launch::{self, LaunchGuard, LaunchResult, ProcessLauncher};
use crate::projects;
use crate::tasks;
use crate::tools::detect::Detector;
use crate::tools::model::RestoreLevel;
use crate::tools::service as tools;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 用户可读标签的最大长度。
const LABEL_MAX: usize = 120;
/// 保存到数据库的失败原因最大长度（已脱敏）。
const ERROR_MAX: usize = 200;

/// 上一次恢复结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RestoreStatus {
    Success,
    Failed,
}

impl RestoreStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RestoreStatus::Success => "success",
            RestoreStatus::Failed => "failed",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "success" => Some(RestoreStatus::Success),
            "failed" => Some(RestoreStatus::Failed),
            _ => None,
        }
    }
}

impl FromSql for RestoreStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        RestoreStatus::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

impl FromSql for RestoreLevel {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        RestoreLevel::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

/// 一条工作上下文记录。名称字段通过 LEFT JOIN 解析；引用的记录不存在时为 null。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    pub id: String,
    pub project_id: String,
    /// 项目名称；项目记录已不存在时为 null。
    pub project_name: Option<String>,
    /// 项目目录当前是否存在且为目录（查询时即时计算）。
    pub project_path_exists: bool,
    pub tool_id: Option<String>,
    pub tool_name: Option<String>,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub label: Option<String>,
    pub restore_level: RestoreLevel,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub last_restore_status: Option<RestoreStatus>,
    /// 经过脱敏的简短失败原因；成功或尚未恢复时为 null。
    pub last_restore_error: Option<String>,
}

/// 创建 / 编辑工作上下文的输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionInput {
    pub project_id: String,
    #[serde(default)]
    pub tool_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

/// 一次成功恢复的结果。
#[derive(Debug)]
pub struct RestoreOutcome {
    pub session: WorkspaceSession,
    pub launch: LaunchResult,
}

const SELECT_SQL: &str = "SELECT w.id, w.project_id, w.tool_id, w.task_id, w.label,
        w.restore_level, w.created_at, w.updated_at, w.last_used_at,
        w.last_restore_status, w.last_restore_error,
        p.name AS project_name, p.path AS project_path,
        t.name AS tool_name, k.title AS task_title
     FROM workspace_sessions w
     LEFT JOIN projects p ON p.id = w.project_id
     LEFT JOIN tool_installations t ON t.id = w.tool_id
     LEFT JOIN tasks k ON k.id = w.task_id";

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSession> {
    let project_path: Option<String> = row.get("project_path")?;
    Ok(WorkspaceSession {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        project_name: row.get("project_name")?,
        project_path_exists: project_path
            .as_deref()
            .map(|path| Path::new(path).is_dir())
            .unwrap_or(false),
        tool_id: row.get("tool_id")?,
        tool_name: row.get("tool_name")?,
        task_id: row.get("task_id")?,
        task_title: row.get("task_title")?,
        label: row.get("label")?,
        restore_level: row.get("restore_level")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_used_at: row.get("last_used_at")?,
        last_restore_status: row.get("last_restore_status")?,
        last_restore_error: row.get("last_restore_error")?,
    })
}

fn normalize_label(raw: &Option<String>) -> Result<Option<String>, AppError> {
    match raw.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.chars().count() > LABEL_MAX => Err(AppError::new(
            "WORKSPACE_LABEL_TOO_LONG",
            format!("上下文名称过长，请控制在 {LABEL_MAX} 个字符以内。"),
        )),
        Some(value) => Ok(Some(value.to_string())),
        None => Ok(None),
    }
}

fn normalize_id(raw: &Option<String>) -> Option<String> {
    raw.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 校验工具引用：必须指向一个已登记（或内置占位）的工具条目。
fn ensure_tool(
    conn: &Connection,
    detector: &dyn Detector,
    tool_id: &Option<String>,
) -> Result<(), AppError> {
    let Some(id) = tool_id.as_deref() else {
        return Ok(());
    };
    let state = tools::tool_state(conn, detector)?;
    if state.entries.iter().any(|entry| entry.id == id) {
        Ok(())
    } else {
        Err(AppError::new(
            "TOOL_NOT_FOUND",
            "未找到该开发工具配置，请重新选择。",
        ))
    }
}

/// 校验任务引用：任务必须存在且属于指定项目。
fn ensure_task(
    conn: &Connection,
    task_id: &Option<String>,
    project_id: &str,
) -> Result<(), AppError> {
    let Some(id) = task_id.as_deref() else {
        return Ok(());
    };
    let task = tasks::get_task(conn, id)?;
    if task.project_id != project_id {
        return Err(AppError::new(
            "WORKSPACE_TASK_MISMATCH",
            "所选任务不属于该项目。",
        ));
    }
    Ok(())
}

pub fn list_sessions(conn: &Connection) -> Result<Vec<WorkspaceSession>, AppError> {
    let sql = format!(
        "{SELECT_SQL}
         ORDER BY w.last_used_at IS NULL ASC, w.last_used_at DESC, w.updated_at DESC, w.id ASC"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], row_to_session)?;
    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row?);
    }
    Ok(sessions)
}

pub fn get_session(conn: &Connection, id: &str) -> Result<WorkspaceSession, AppError> {
    conn.query_row(&format!("{SELECT_SQL} WHERE w.id = ?1"), [id], row_to_session)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::new("WORKSPACE_NOT_FOUND", "未找到该工作上下文记录。")
            }
            other => other.into(),
        })
}

/// 最近一次使用的工作上下文；从未恢复过时取最近更新的记录。
pub fn last_session(conn: &Connection) -> Result<Option<WorkspaceSession>, AppError> {
    let sql = format!(
        "{SELECT_SQL}
         ORDER BY w.last_used_at IS NULL ASC, w.last_used_at DESC, w.updated_at DESC, w.id ASC
         LIMIT 1"
    );
    Ok(conn
        .query_row(&sql, [], row_to_session)
        .optional()?)
}

pub fn create_session(
    conn: &Connection,
    detector: &dyn Detector,
    input: WorkspaceSessionInput,
) -> Result<WorkspaceSession, AppError> {
    if input.project_id.trim().is_empty() {
        return Err(AppError::new(
            "WORKSPACE_PROJECT_REQUIRED",
            "工作上下文必须关联一个项目。",
        ));
    }
    projects::get_project(conn, &input.project_id)?;
    let tool_id = normalize_id(&input.tool_id);
    let task_id = normalize_id(&input.task_id);
    ensure_tool(conn, detector, &tool_id)?;
    ensure_task(conn, &task_id, &input.project_id)?;
    let label = normalize_label(&input.label)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();
    conn.execute(
        "INSERT INTO workspace_sessions
            (id, project_id, tool_id, task_id, label, restore_level,
             created_at, updated_at, last_used_at, last_restore_status, last_restore_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL, NULL, NULL)",
        params![
            id,
            input.project_id,
            tool_id,
            task_id,
            label,
            RestoreLevel::Project.as_str(),
            now,
        ],
    )?;
    get_session(conn, &id)
}

/// 更新工作上下文关联的工具 / 任务与标签；项目不可更改。
pub fn update_session(
    conn: &Connection,
    detector: &dyn Detector,
    id: &str,
    input: WorkspaceSessionInput,
) -> Result<WorkspaceSession, AppError> {
    let existing = get_session(conn, id)?;
    let tool_id = normalize_id(&input.tool_id);
    let task_id = normalize_id(&input.task_id);
    ensure_tool(conn, detector, &tool_id)?;
    ensure_task(conn, &task_id, &existing.project_id)?;
    let label = normalize_label(&input.label)?;

    conn.execute(
        "UPDATE workspace_sessions SET tool_id = ?1, task_id = ?2, label = ?3, updated_at = ?4
         WHERE id = ?5",
        params![tool_id, task_id, label, crate::now_iso(), id],
    )?;
    get_session(conn, id)
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<(), AppError> {
    let affected = conn.execute("DELETE FROM workspace_sessions WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new(
            "WORKSPACE_NOT_FOUND",
            "未找到该工作上下文记录。",
        ));
    }
    Ok(())
}

/// 把恢复失败原因脱敏为简短、可展示的文本；绝不写入完整命令行或绝对路径。
fn sanitize_restore_error(code: &str) -> String {
    let text = match code {
        "PROJECT_PATH_MISSING" | "PROJECT_PATH_NOT_DIR" | "PROJECT_PATH_INACCESSIBLE" => {
            "项目目录不存在或不可访问"
        }
        "PATH_NOT_FOUND" | "PATH_NOT_A_FILE" => "工具可执行文件不存在或无效",
        "TOOL_NOT_READY" => "工具当前不可用",
        "TOOL_NOT_FOUND" => "未找到该工具配置",
        "TOOL_CONFIG_REQUIRED" => "尚未为项目选择开发工具",
        "LAUNCH_NEEDS_CONFIGURATION" => "工具需要补充配置",
        "LAUNCH_UNSUPPORTED" => "该工具不支持受控启动",
        "LAUNCH_DUPLICATE" => "刚刚已启动，请稍候再试",
        "LAUNCH_FAILED" => "系统拒绝创建进程",
        _ => "恢复失败",
    };
    text.chars().take(ERROR_MAX).collect()
}

fn record_failure(conn: &Connection, id: &str, code: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE workspace_sessions
            SET last_restore_status = ?1, last_restore_error = ?2, updated_at = ?3
         WHERE id = ?4",
        params![
            RestoreStatus::Failed.as_str(),
            sanitize_restore_error(code),
            crate::now_iso(),
            id,
        ],
    )?;
    Ok(())
}

/// 恢复工作上下文：重新启动所选工具并打开项目目录。
///
/// `tool_id_override` 用于「恢复前切换工具」；成功后写入该工具的最近使用时间与
/// 成功状态，失败时保留记录并写入脱敏后的原因，便于修复后重试。
pub fn restore_session(
    conn: &Connection,
    launcher: &dyn ProcessLauncher,
    guard: &LaunchGuard,
    detector: &dyn Detector,
    id: &str,
    tool_id_override: Option<&str>,
) -> Result<RestoreOutcome, AppError> {
    let session = get_session(conn, id)?;

    if session.restore_level != RestoreLevel::Project {
        // 防御：当前版本只支持 Level 1，历史或异常值不应被误当作可恢复。
        return Err(AppError::new(
            "RESTORE_LEVEL_UNSUPPORTED",
            "该工作上下文使用了当前不支持的恢复层级。",
        ));
    }

    let tool_id = normalize_id(&tool_id_override.map(str::to_string))
        .or_else(|| session.tool_id.clone());

    // 工具引用必须重新校验，避免配置在保存后被删除。
    ensure_tool(conn, detector, &tool_id)?;

    match launch::launch(
        conn,
        launcher,
        guard,
        &session.project_id,
        tool_id.as_deref(),
        detector,
    ) {
        Ok(launch_result) => {
            let now = crate::now_iso();
            // 记录本次实际使用的工具（可能来自项目默认工具或本次覆盖选择），
            // 使上下文自描述，后续恢复无需再依赖项目默认值。
            conn.execute(
                "UPDATE workspace_sessions
                    SET tool_id = ?1, last_used_at = ?2, updated_at = ?2,
                        last_restore_status = ?3, last_restore_error = NULL
                 WHERE id = ?4",
                params![
                    launch_result.tool_id,
                    now,
                    RestoreStatus::Success.as_str(),
                    id,
                ],
            )?;
            let session = get_session(conn, id)?;
            Ok(RestoreOutcome {
                session,
                launch: launch_result,
            })
        }
        Err(error) => {
            // 防抖拒绝不是真正的恢复失败，不写入失败状态，避免误导用户。
            if error.code != "LAUNCH_DUPLICATE" {
                record_failure(conn, id, &error.code)?;
            }
            Err(error)
        }
    }
}
