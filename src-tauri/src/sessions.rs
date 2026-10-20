//! AI 工具会话（会话数据模型）。
//!
//! 会话是「某个项目 + 某款工具」下的一条记录，用于长期保存该工具内的一个会话：
//! 显示名称由 VibeAcross 管理，原生会话 ID（如适用）用于定位工具内部的真实会话。
//! 每个会话必须且只能属于一条有效的项目 × 工具关联（见 [`crate::project_tools`]），
//! 该约束由数据库外键保证，所有操作都在后端重新校验，绝不只信任前端传入的 id。
//!
//! 边界：
//!  - 不读取 / 修改任何第三方工具的内部数据库或会话文件。
//!  - 不保存对话内容、文件内容、密钥、访问令牌或环境变量。
//!  - 本模块的 [`delete`] 只删除 VibeAcross 自身的记录；原生删除由 `native`
//!    模块按明确的删除范围协调，绝不把本地清理误认为原生删除。

use crate::error::AppError;
use crate::native_claims;
use crate::project_tools;
use crate::projects;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 显示名称最大长度。
const DISPLAY_NAME_MAX: usize = 120;
/// 原生会话 ID 最大长度。
const NATIVE_ID_MAX: usize = 200;

/// 会话状态。
///
/// `NativeDeleted` 只由原生删除流程写入：工具中的原生会话已被确认删除，但用户选择
/// 保留 VibeAcross 本地记录。它不是用户可编辑状态，也不能再伪装成可恢复的会话。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Active,
    Archived,
    NativeDeleted,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Active => "active",
            SessionStatus::Archived => "archived",
            SessionStatus::NativeDeleted => "nativeDeleted",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "active" => Some(SessionStatus::Active),
            "archived" => Some(SessionStatus::Archived),
            "nativeDeleted" => Some(SessionStatus::NativeDeleted),
            _ => None,
        }
    }
}

impl FromSql for SessionStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        SessionStatus::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

/// 一条会话记录。项目 / 工具信息通过联表即时解析，不重复持久化。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_tool_id: String,
    /// 由所属关联派生，便于前端按项目 / 工具过滤与展示。
    pub project_id: String,
    pub tool_id: String,
    pub project_name: Option<String>,
    pub tool_name: Option<String>,
    /// 显示名称；由 VibeAcross 管理，允许重复。
    pub display_name: String,
    /// 工具公开提供的原生会话标识；工具未提供时为 null。
    pub native_session_id: Option<String>,
    /// 会话工作目录；为空时代表使用项目目录本身。
    pub working_directory: Option<String>,
    pub status: SessionStatus,
    pub created_at: String,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    /// 查询时即时计算：所属项目目录当前是否存在且为目录。
    pub project_path_exists: bool,
}

/// 创建会话的输入。会话所属的项目 → 工具关联会在后端自动建立（若尚不存在）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub project_id: String,
    pub tool_id: String,
    pub display_name: String,
    #[serde(default)]
    pub native_session_id: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
}

/// 会话列表查询条件。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuery {
    pub project_id: Option<String>,
    pub tool_id: Option<String>,
    pub status: Option<SessionStatus>,
}

const SELECT_SQL: &str = "SELECT s.id, s.project_tool_id, pt.project_id, pt.tool_id,
        s.display_name, s.native_session_id, s.working_directory, s.status,
        s.created_at, s.updated_at, s.last_used_at,
        p.name AS project_name, p.path AS project_path, t.name AS tool_name
     FROM sessions s
     JOIN project_tools pt ON pt.id = s.project_tool_id
     LEFT JOIN projects p ON p.id = pt.project_id
     LEFT JOIN tool_installations t ON t.id = pt.tool_id";

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<Session> {
    let project_path: Option<String> = row.get("project_path")?;
    Ok(Session {
        id: row.get("id")?,
        project_tool_id: row.get("project_tool_id")?,
        project_id: row.get("project_id")?,
        tool_id: row.get("tool_id")?,
        project_name: row.get("project_name")?,
        tool_name: row.get("tool_name")?,
        display_name: row.get("display_name")?,
        native_session_id: row.get("native_session_id")?,
        working_directory: row.get("working_directory")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_used_at: row.get("last_used_at")?,
        project_path_exists: project_path
            .as_deref()
            .map(|path| Path::new(path).is_dir())
            .unwrap_or(false),
    })
}

fn validate_display_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::new(
            "SESSION_NAME_EMPTY",
            "会话名称不能为空。",
        ));
    }
    if name.chars().count() > DISPLAY_NAME_MAX {
        return Err(AppError::new(
            "SESSION_NAME_TOO_LONG",
            format!("会话名称过长，请控制在 {DISPLAY_NAME_MAX} 个字符以内。"),
        ));
    }
    Ok(name.to_string())
}

fn normalize_native_id(raw: &Option<String>) -> Result<Option<String>, AppError> {
    let cleaned = raw
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match cleaned {
        Some(value) if value.chars().count() > NATIVE_ID_MAX => Err(AppError::new(
            "SESSION_NATIVE_ID_TOO_LONG",
            format!("原生会话标识过长，请控制在 {NATIVE_ID_MAX} 个字符以内。"),
        )),
        Some(value) => Ok(Some(value.to_string())),
        None => Ok(None),
    }
}

/// 判断 `candidate` 是否位于 `root` 目录内（Windows 路径大小写不敏感）。
fn is_within(root: &str, candidate: &str) -> bool {
    let root = root.trim_end_matches(['\\', '/']).to_ascii_lowercase();
    let candidate = candidate.trim_end_matches(['\\', '/']).to_ascii_lowercase();
    candidate == root
        || candidate.starts_with(&format!("{root}\\"))
        || candidate.starts_with(&format!("{root}/"))
}

/// 校验并规范化会话工作目录：必须存在，且位于所属项目目录内。
///
/// 未提供时返回 `None`（读取时以项目目录为准）；这样既避免与 `projects.path`
/// 重复保存，也防止会话指向项目之外的任意目录。
fn resolve_working_directory(
    project_path: &str,
    raw: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let dir = projects::normalize_existing_dir(value)?;
    if !is_within(project_path, &dir) {
        return Err(AppError::new(
            "SESSION_DIR_OUTSIDE_PROJECT",
            "会话工作目录必须位于项目目录内。",
        ));
    }
    Ok(Some(dir))
}

pub fn get(conn: &Connection, id: &str) -> Result<Session, AppError> {
    conn.query_row(&format!("{SELECT_SQL} WHERE s.id = ?1"), [id], row_to_session)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::new("SESSION_NOT_FOUND", "未找到该会话记录。")
            }
            other => other.into(),
        })
}

/// 查询会话列表。可按项目 / 工具 / 状态过滤；不同工具的会话互不可见。
pub fn list(conn: &Connection, query: &SessionQuery) -> Result<Vec<Session>, AppError> {
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(project_id) = query
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!("pt.project_id = ?{}", values.len() + 1));
        values.push(Box::new(project_id.to_string()));
    }
    if let Some(tool_id) = query
        .tool_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!("pt.tool_id = ?{}", values.len() + 1));
        values.push(Box::new(tool_id.to_string()));
    }
    if let Some(status) = query.status {
        clauses.push(format!("s.status = ?{}", values.len() + 1));
        values.push(Box::new(status.as_str().to_string()));
    }

    let mut sql = SELECT_SQL.to_string();
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(
        " ORDER BY s.last_used_at IS NULL ASC, s.last_used_at DESC, s.created_at DESC, s.id ASC",
    );

    let params: Vec<&dyn rusqlite::types::ToSql> =
        values.iter().map(|value| value.as_ref()).collect();
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params.as_slice(), row_to_session)?;
    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row?);
    }
    Ok(sessions)
}

/// 创建会话。所属「项目 × 工具」关联不存在时自动建立。
pub fn create(conn: &Connection, input: SessionInput) -> Result<Session, AppError> {
    let project_id = input.project_id.trim();
    if project_id.is_empty() {
        return Err(AppError::new(
            "SESSION_PROJECT_REQUIRED",
            "会话必须关联一个项目。",
        ));
    }
    let tool_id = input.tool_id.trim();
    if tool_id.is_empty() {
        return Err(AppError::new(
            "SESSION_TOOL_REQUIRED",
            "会话必须关联一款开发工具。",
        ));
    }

    // 项目与工具引用均在后端校验；关联由 project_tools 统一维护。
    let project = projects::get_project(conn, project_id)?;
    let display_name = validate_display_name(&input.display_name)?;
    let native_session_id = normalize_native_id(&input.native_session_id)?;
    let working_directory =
        resolve_working_directory(&project.path, input.working_directory.as_deref())?;
    let association = project_tools::ensure(conn, project_id, tool_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();

    // 归属登记与会话行必须原子写入：若登记成功但随后的会话写入失败（唯一约束、
    // IO 或进程中断），必须一并回滚，否则会残留「已认领却无会话」的归属，
    // 永久阻塞该原生会话被其它项目使用。
    let tx = conn.unchecked_transaction()?;
    if let Some(native_id) = native_session_id.as_deref() {
        if !record_native_claim(&tx, &association.id, native_id)? {
            return Err(claimed_elsewhere_err());
        }
    }
    tx.execute(
        "INSERT INTO sessions
            (id, project_tool_id, display_name, native_session_id, working_directory,
             status, created_at, updated_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL)",
        params![
            id,
            association.id,
            display_name,
            native_session_id,
            working_directory,
            SessionStatus::Active.as_str(),
            now,
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // 唯一索引：同一项目工具关联下该原生会话已存在。
            AppError::new(
                "SESSION_NATIVE_ID_DUPLICATE",
                "该原生会话已关联到当前项目与工具。",
            )
        }
        other => other.into(),
    })?;
    tx.commit()?;
    get(conn, &id)
}

/// 按关联 + 原生会话标识查找本地记录。
pub fn find_by_native(
    conn: &Connection,
    project_tool_id: &str,
    native_session_id: &str,
) -> Result<Option<Session>, AppError> {
    let mut statement = conn.prepare(&format!(
        "{SELECT_SQL} WHERE s.project_tool_id = ?1 AND s.native_session_id = ?2"
    ))?;
    let mut rows =
        statement.query_map(params![project_tool_id, native_session_id], row_to_session)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// 登记一条原生会话的归属（以项目身份为单位，而非路径 / 名称）。
///
/// 仅在「项目 × 工具」关联可解析时执行；已属于同一项目身份时幂等，已被其它项目
/// 身份（含已被移除的项目）认领时不夺取。这是避免同路径重建项目误接管旧会话的关键。
///
/// 返回 `true` 表示该原生会话现归属于本项目身份；`false` 表示已被**其它**项目身份
/// 认领——调用方据此拒绝把这条原生会话写入本项目，杜绝跨项目重复归属。
fn record_native_claim(
    conn: &Connection,
    project_tool_id: &str,
    native_session_id: &str,
) -> Result<bool, AppError> {
    match native_claims::association_identity(conn, project_tool_id)? {
        Some((tool_id, project_id)) => {
            native_claims::claim(conn, &tool_id, native_session_id, &project_id)
        }
        // 关联不存在（例如刚被删除）：无从登记，按「可写入」放行，交由后续校验处理。
        None => Ok(true),
    }
}

fn claimed_elsewhere_err() -> AppError {
    AppError::new(
        "SESSION_NATIVE_CLAIMED_ELSEWHERE",
        "该原生会话已归属于另一个项目，不能在当前项目下重复关联。",
    )
}

/// 直接插入一条带原生会话标识的会话记录。
///
/// 供原生适配层在工具已真实创建会话后调用；关联必须已存在（由调用方保证）。
pub fn insert_native(
    conn: &Connection,
    project_tool_id: &str,
    display_name: &str,
    native_session_id: &str,
    working_directory: Option<&str>,
) -> Result<Session, AppError> {
    let display_name = validate_display_name(display_name)?;
    let native_session_id = normalize_native_id(&Some(native_session_id.to_string()))?
        .ok_or_else(|| AppError::new("SESSION_NATIVE_ID_REQUIRED", "原生会话标识不能为空。"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();

    // 与 create 同理：归属登记与会话行原子写入，失败一并回滚，避免残留
    // 「已认领却无会话」的归属记录。
    let tx = conn.unchecked_transaction()?;
    if !record_native_claim(&tx, project_tool_id, &native_session_id)? {
        return Err(claimed_elsewhere_err());
    }
    tx.execute(
        "INSERT INTO sessions
            (id, project_tool_id, display_name, native_session_id, working_directory,
             status, created_at, updated_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL)",
        params![
            id,
            project_tool_id,
            display_name,
            native_session_id,
            working_directory,
            SessionStatus::Active.as_str(),
            now,
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::new(
                "SESSION_NATIVE_ID_DUPLICATE",
                "该原生会话已关联到当前项目与工具。",
            )
        }
        other => other.into(),
    })?;
    tx.commit()?;
    get(conn, &id)
}

/// 幂等导入原生会话：已存在同标识记录时原样返回（保留本地显示名，不覆盖）。
pub fn upsert_native(
    conn: &Connection,
    project_tool_id: &str,
    display_name: &str,
    native_session_id: &str,
    working_directory: Option<&str>,
) -> Result<Session, AppError> {
    if let Some(existing) = find_by_native(conn, project_tool_id, native_session_id)? {
        // 既有本地记录：登记归属（幂等）后原样返回；即使归属登记因历史数据不一致
        // 而未归本项目，也不改动既有记录，避免破坏用户可见的本地会话。
        let _ = record_native_claim(conn, project_tool_id, native_session_id)?;
        return Ok(existing);
    }
    insert_native(
        conn,
        project_tool_id,
        display_name,
        native_session_id,
        working_directory,
    )
}

/// 重命名会话（仅改显示名称）。
pub fn rename(conn: &Connection, id: &str, display_name_raw: &str) -> Result<Session, AppError> {
    get(conn, id)?;
    let display_name = validate_display_name(display_name_raw)?;
    conn.execute(
        "UPDATE sessions SET display_name = ?1, updated_at = ?2 WHERE id = ?3",
        params![display_name, crate::now_iso(), id],
    )?;
    get(conn, id)
}

/// 设置用户可编辑的会话状态（active / archived）。
///
/// `nativeDeleted` 是删除流程产生的只读状态，不能通过此接口由前端设置。
pub fn set_status(
    conn: &Connection,
    id: &str,
    status: SessionStatus,
) -> Result<Session, AppError> {
    if status == SessionStatus::NativeDeleted {
        return Err(AppError::new(
            "SESSION_STATUS_INVALID",
            "原生会话已删除状态只能由删除流程设置。",
        ));
    }
    get(conn, id)?;
    conn.execute(
        "UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status.as_str(), crate::now_iso(), id],
    )?;
    get(conn, id)
}

/// 将本地记录标记为「原生会话已删除」，保留记录本身。
///
/// 仅由原生删除成功后的后端流程调用。使用现有 `status` 字段即可表达该状态，
/// 不需要新增迁移或破坏既有数据结构。
pub fn mark_native_deleted(conn: &Connection, id: &str) -> Result<Session, AppError> {
    get(conn, id)?;
    conn.execute(
        "UPDATE sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            SessionStatus::NativeDeleted.as_str(),
            crate::now_iso(),
            id
        ],
    )?;
    get(conn, id)
}

/// 记录一次会话使用（更新最近使用时间）。
pub fn touch(conn: &Connection, id: &str) -> Result<Session, AppError> {
    get(conn, id)?;
    let now = crate::now_iso();
    conn.execute(
        "UPDATE sessions SET last_used_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    get(conn, id)
}

/// 删除会话记录。只删除 VibeAcross 自身的记录，不影响工具内部的原生会话。
pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let affected = conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new("SESSION_NOT_FOUND", "未找到该会话记录。"));
    }
    Ok(())
}

/// 便捷读取：按关联统计会话数（测试辅助）。
#[allow(dead_code)]
pub fn count_for_association(conn: &Connection, project_tool_id: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM sessions WHERE project_tool_id = ?1",
        [project_tool_id],
        |row| row.get(0),
    )?)
}
