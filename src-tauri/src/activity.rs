//! 活动记录（Phase 6）。
//!
//! 记录 VibeAcross 应用自身的真实操作历史，不涉及任何操作系统级监控，
//! 也不保存完整命令行、令牌、环境变量或文件内容等敏感信息。
//!
//! 活动写入为「尽力而为」：记录失败不应使原本成功的业务操作失败，
//! 因此命令层使用 [`record_quietly`]。

use crate::error::AppError;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// 活动发生时间与摘要的最大长度，防止异常长文本。
const SUMMARY_MAX: usize = 300;

/// 活动类型。序列化为 PascalCase，与前端既有分类一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivityType {
    Project,
    Tool,
    Task,
    System,
}

impl ActivityType {
    pub fn as_str(self) -> &'static str {
        match self {
            ActivityType::Project => "Project",
            ActivityType::Tool => "Tool",
            ActivityType::Task => "Task",
            ActivityType::System => "System",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "Project" => Some(ActivityType::Project),
            "Tool" => Some(ActivityType::Tool),
            "Task" => Some(ActivityType::Task),
            "System" => Some(ActivityType::System),
            _ => None,
        }
    }
}

impl FromSql for ActivityType {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        ActivityType::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

/// 一条活动记录。`project_name` 在查询时通过 LEFT JOIN 解析；
/// 项目已删除时为 null，前端回退显示「已删除的项目」。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLog {
    pub id: String,
    pub project_id: Option<String>,
    pub event_type: ActivityType,
    pub summary: String,
    pub created_at: String,
    pub project_name: Option<String>,
}

/// 活动查询条件。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilter {
    pub project_id: Option<String>,
    pub event_type: Option<ActivityType>,
    /// 返回条数上限；缺省 50，硬上限 200。
    pub limit: Option<u32>,
    /// 偏移量，用于分批加载。
    pub offset: Option<u32>,
    /// 仅返回此时间（ISO 8601）之后的活动，可为空。
    pub since: Option<String>,
}

/// 分页结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub items: Vec<ActivityLog>,
    /// 满足筛选条件的记录总数。
    pub total: i64,
}

const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;

/// 写入一条活动记录。摘要会被裁剪并去除首尾空白。
pub fn record(
    conn: &Connection,
    event_type: ActivityType,
    project_id: Option<&str>,
    summary: &str,
) -> Result<(), AppError> {
    let cleaned = summary.trim();
    if cleaned.is_empty() {
        return Ok(());
    }
    let summary: String = cleaned.chars().take(SUMMARY_MAX).collect();
    let project_id = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty());

    conn.execute(
        "INSERT INTO activity_logs (id, project_id, event_type, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            project_id,
            event_type.as_str(),
            summary,
            crate::now_iso(),
        ],
    )?;
    Ok(())
}

/// 尽力写入活动记录：失败只打印诊断信息，不影响调用方。
pub fn record_quietly(
    conn: &Connection,
    event_type: ActivityType,
    project_id: Option<&str>,
    summary: &str,
) {
    if let Err(error) = record(conn, event_type, project_id, summary) {
        eprintln!("[activity] 记录活动失败（已忽略）：{error}");
    }
}

fn row_to_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityLog> {
    Ok(ActivityLog {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        event_type: row.get("event_type")?,
        summary: row.get("summary")?,
        created_at: row.get("created_at")?,
        project_name: row.get("project_name")?,
    })
}

/// 组装 WHERE 子句与参数（list 与 count 共用）。
fn build_filters(filter: &ActivityFilter) -> (Vec<String>, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(project_id) = filter
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!("a.project_id = ?{}", values.len() + 1));
        values.push(Box::new(project_id.to_string()));
    }
    if let Some(event_type) = filter.event_type {
        clauses.push(format!("a.event_type = ?{}", values.len() + 1));
        values.push(Box::new(event_type.as_str().to_string()));
    }
    if let Some(since) = filter
        .since
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!("a.created_at > ?{}", values.len() + 1));
        values.push(Box::new(since.to_string()));
    }

    (clauses, values)
}

/// 按时间倒序分页查询活动记录。
pub fn list_activity(
    conn: &Connection,
    filter: &ActivityFilter,
) -> Result<ActivityPage, AppError> {
    let (clauses, values) = build_filters(filter);
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };

    let total: i64 = {
        let sql = format!("SELECT COUNT(*) FROM activity_logs a{where_sql}");
        let params: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|value| value.as_ref()).collect();
        conn.query_row(&sql, params.as_slice(), |row| row.get(0))?
    };

    let limit = filter.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = filter.offset.unwrap_or(0);

    let limit_index = values.len() + 1;
    let offset_index = values.len() + 2;
    let sql = format!(
        "SELECT a.id, a.project_id, a.event_type, a.summary, a.created_at, p.name AS project_name
         FROM activity_logs a
         LEFT JOIN projects p ON p.id = a.project_id
         {where_sql}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ?{limit_index} OFFSET ?{offset_index}"
    );

    let mut all: Vec<Box<dyn rusqlite::types::ToSql>> = values;
    all.push(Box::new(limit as i64));
    all.push(Box::new(offset as i64));
    let params: Vec<&dyn rusqlite::types::ToSql> =
        all.iter().map(|value| value.as_ref()).collect();

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params.as_slice(), row_to_log)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }

    Ok(ActivityPage { items, total })
}

/// 清理活动记录。传入 `project_id` 时仅清理该项目的记录，否则清空全部。
pub fn clear_activity(conn: &Connection, project_id: Option<&str>) -> Result<u64, AppError> {
    let deleted = match project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(id) => conn.execute("DELETE FROM activity_logs WHERE project_id = ?1", [id])?,
        None => conn.execute("DELETE FROM activity_logs", [])?,
    };
    Ok(deleted as u64)
}
