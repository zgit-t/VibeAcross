//! 任务管理（Phase 6）。
//!
//! 任务始终关联一个有效项目；状态 / 优先级 / 截止日期均在后端校验，
//! 保证不会写入无效值。完成任务写入 `completed_at`，重新打开则清空。

use crate::error::AppError;
use crate::projects;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const TITLE_MAX: usize = 200;
const DESCRIPTION_MAX: usize = 2000;

/// 任务状态。至少包含待处理 / 进行中 / 已完成。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Todo,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Todo => "todo",
            TaskStatus::InProgress => "inProgress",
            TaskStatus::Done => "done",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "todo" => Some(TaskStatus::Todo),
            "inProgress" => Some(TaskStatus::InProgress),
            "done" => Some(TaskStatus::Done),
            _ => None,
        }
    }
}

impl FromSql for TaskStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        TaskStatus::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

/// 任务优先级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    Low,
    Medium,
    High,
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskPriority::Low => "low",
            TaskPriority::Medium => "medium",
            TaskPriority::High => "high",
        }
    }

    pub fn from_code(value: &str) -> Option<Self> {
        match value {
            "low" => Some(TaskPriority::Low),
            "medium" => Some(TaskPriority::Medium),
            "high" => Some(TaskPriority::High),
            _ => None,
        }
    }
}

impl FromSql for TaskPriority {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        TaskPriority::from_code(text).ok_or(FromSqlError::InvalidType)
    }
}

/// 任务记录。字段以 camelCase 序列化给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    /// 截止日期（YYYY-MM-DD），可选。
    pub due_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 完成时间，未完成时为 null。
    pub completed_at: Option<String>,
}

/// 创建 / 编辑任务的输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    /// 创建时缺省为 Todo；编辑时缺省保留原状态。
    #[serde(default)]
    pub status: Option<TaskStatus>,
    pub priority: TaskPriority,
    #[serde(default)]
    pub due_date: Option<String>,
}

/// 任务列表查询条件。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuery {
    pub project_id: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    pub search: Option<String>,
    /// "created" | "updated"（默认 updated）。
    pub sort: Option<String>,
}

/// 任务统计（按状态计数）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStats {
    pub todo: i64,
    pub in_progress: i64,
    pub done: i64,
    pub total: i64,
}

const SELECT_COLUMNS: &str = "id, project_id, title, description, status, priority, due_date, \
     created_at, updated_at, completed_at";

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        due_date: row.get("due_date")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn validate_title(raw: &str) -> Result<String, AppError> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(AppError::new("TASK_TITLE_EMPTY", "任务标题不能为空。"));
    }
    if title.chars().count() > TITLE_MAX {
        return Err(AppError::new(
            "TASK_TITLE_TOO_LONG",
            format!("任务标题过长，请控制在 {TITLE_MAX} 个字符以内。"),
        ));
    }
    Ok(title.to_string())
}

fn validate_description(raw: &Option<String>) -> Result<Option<String>, AppError> {
    let cleaned = raw
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match cleaned {
        Some(value) if value.chars().count() > DESCRIPTION_MAX => Err(AppError::new(
            "TASK_DESCRIPTION_TOO_LONG",
            format!("任务描述过长，请控制在 {DESCRIPTION_MAX} 个字符以内。"),
        )),
        Some(value) => Ok(Some(value.to_string())),
        None => Ok(None),
    }
}

fn validate_due_date(raw: &Option<String>) -> Result<Option<String>, AppError> {
    let cleaned = raw
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match cleaned {
        None => Ok(None),
        Some(value) => {
            // 仅接受 YYYY-MM-DD 日期；不存储时间与时区，避免本地显示产生偏移。
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                AppError::new("TASK_DUE_DATE_INVALID", "截止日期格式无效，应为 YYYY-MM-DD。")
            })?;
            Ok(Some(value.to_string()))
        }
    }
}

fn ensure_project(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    if project_id.trim().is_empty() {
        return Err(AppError::new("TASK_PROJECT_REQUIRED", "任务必须关联一个项目。"));
    }
    projects::get_project(conn, project_id).map(|_| ())
}

pub fn get_task(conn: &Connection, id: &str) -> Result<Task, AppError> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM tasks WHERE id = ?1"),
        [id],
        row_to_task,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::new("TASK_NOT_FOUND", "未找到该任务记录。")
        }
        other => other.into(),
    })
}

/// 创建任务。`status` 缺省为 Todo；若直接以 Done 创建则记录完成时间。
pub fn create_task(conn: &Connection, input: TaskInput) -> Result<Task, AppError> {
    ensure_project(conn, &input.project_id)?;
    let title = validate_title(&input.title)?;
    let description = validate_description(&input.description)?;
    let due_date = validate_due_date(&input.due_date)?;
    let status = input.status.unwrap_or(TaskStatus::Todo);

    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();
    let completed_at = if status == TaskStatus::Done {
        Some(now.clone())
    } else {
        None
    };

    conn.execute(
        "INSERT INTO tasks
            (id, project_id, title, description, status, priority, due_date,
             created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)",
        params![
            id,
            input.project_id,
            title,
            description,
            status.as_str(),
            input.priority.as_str(),
            due_date,
            now,
            completed_at,
        ],
    )
    .map_err(|error| error.into())
    .and_then(|_| get_task(conn, &id))
}

/// 更新任务。`status` 缺省保留原状态。
pub fn update_task(conn: &Connection, id: &str, input: TaskInput) -> Result<Task, AppError> {
    let existing = get_task(conn, id)?;
    ensure_project(conn, &input.project_id)?;
    let title = validate_title(&input.title)?;
    let description = validate_description(&input.description)?;
    let due_date = validate_due_date(&input.due_date)?;
    let status = input.status.unwrap_or(existing.status);

    let now = crate::now_iso();
    let completed_at = match status {
        TaskStatus::Done => Some(existing.completed_at.clone().unwrap_or_else(|| now.clone())),
        _ => None,
    };

    conn.execute(
        "UPDATE tasks SET
            project_id = ?1, title = ?2, description = ?3, status = ?4, priority = ?5,
            due_date = ?6, updated_at = ?7, completed_at = ?8
         WHERE id = ?9",
        params![
            input.project_id,
            title,
            description,
            status.as_str(),
            input.priority.as_str(),
            due_date,
            now,
            completed_at,
            id,
        ],
    )?;
    get_task(conn, id)
}

/// 切换任务状态。完成时写入 `completed_at`，重新打开时清空。
///
/// 状态未变化时不做改动，避免产生无意义的更新时间与活动记录。
pub fn set_task_status(
    conn: &Connection,
    id: &str,
    status: TaskStatus,
) -> Result<Task, AppError> {
    let existing = get_task(conn, id)?;
    if existing.status == status {
        return Ok(existing);
    }

    let now = crate::now_iso();
    let completed_at = match status {
        TaskStatus::Done => Some(now.clone()),
        _ => None,
    };

    conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![status.as_str(), completed_at, now, id],
    )?;
    get_task(conn, id)
}

/// 删除任务。
///
/// 同一事务内把工作上下文中对该任务的引用置空，使上下文仍然可用。
pub fn delete_task(conn: &Connection, id: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE workspace_sessions SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",
        params![crate::now_iso(), id],
    )?;
    let affected = tx.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new("TASK_NOT_FOUND", "未找到该任务记录。"));
    }
    tx.commit()?;
    Ok(())
}

/// 转义 LIKE 通配符，按字面量匹配搜索词。
fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 查询任务列表。
pub fn list_tasks(conn: &Connection, query: &TaskQuery) -> Result<Vec<Task>, AppError> {
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(project_id) = query
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!("project_id = ?{}", values.len() + 1));
        values.push(Box::new(project_id.to_string()));
    }
    if let Some(status) = query.status {
        clauses.push(format!("status = ?{}", values.len() + 1));
        values.push(Box::new(status.as_str().to_string()));
    }
    if let Some(priority) = query.priority {
        clauses.push(format!("priority = ?{}", values.len() + 1));
        values.push(Box::new(priority.as_str().to_string()));
    }
    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        clauses.push(format!(
            "(title LIKE ?{n} ESCAPE '\\' OR IFNULL(description, '') LIKE ?{n} ESCAPE '\\')",
            n = values.len() + 1
        ));
        values.push(Box::new(format!("%{}%", escape_like(search))));
    }

    let order_by = match query.sort.as_deref() {
        Some("created") => "created_at DESC",
        _ => "updated_at DESC",
    };

    let mut sql = format!("SELECT {SELECT_COLUMNS} FROM tasks");
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(&format!(" ORDER BY {order_by}, id ASC"));

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|value| value.as_ref()).collect();
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params.as_slice(), row_to_task)?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row?);
    }
    Ok(tasks)
}

pub fn task_stats(conn: &Connection) -> Result<TaskStats, AppError> {
    let stats = conn.query_row(
        "SELECT
            COALESCE(SUM(status = 'todo'), 0),
            COALESCE(SUM(status = 'inProgress'), 0),
            COALESCE(SUM(status = 'done'), 0),
            COUNT(*)
         FROM tasks",
        [],
        |row| {
            Ok(TaskStats {
                todo: row.get(0)?,
                in_progress: row.get(1)?,
                done: row.get(2)?,
                total: row.get(3)?,
            })
        },
    )?;
    Ok(stats)
}
