//! 项目 × 工具关联（会话数据模型）。
//!
//! 一个项目可以关联多款开发工具，一款工具也可以关联多个项目；每条关联记录是
//! 会话的「归属容器」：每个会话必须且只能属于一条关联。删除项目 / 工具安装时，
//! 由外键级联清理关联及其会话（见迁移 `0007_session_model`）。
//!
//! 关联只保存最少数据：`projects` 与 `tool_installations` 分别提供项目与工具的
//! 显示信息，关联记录内不重复保存名称或路径。

use crate::error::AppError;
use crate::projects;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// 一条项目 × 工具关联记录。字段以 camelCase 序列化给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTool {
    pub id: String,
    pub project_id: String,
    pub tool_id: String,
    pub created_at: String,
    pub updated_at: String,
    /// 查询时即时计算：该关联下的会话数量（含已归档）。
    pub session_count: i64,
}

/// 建立关联的输入。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToolInput {
    pub project_id: String,
    pub tool_id: String,
}

const SELECT_SQL: &str = "SELECT pt.id, pt.project_id, pt.tool_id, pt.created_at, pt.updated_at,
        (SELECT COUNT(*) FROM sessions s WHERE s.project_tool_id = pt.id) AS session_count
     FROM project_tools pt";

fn row_to_project_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectTool> {
    Ok(ProjectTool {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        tool_id: row.get("tool_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        session_count: row.get("session_count")?,
    })
}

/// 校验工具安装配置存在（必须指向一条已登记的 `tool_installations` 记录）。
pub(crate) fn ensure_tool_exists(conn: &Connection, tool_id: &str) -> Result<(), AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tool_installations WHERE id = ?1",
        [tool_id],
        |row| row.get(0),
    )?;
    if count == 0 {
        return Err(AppError::new(
            "TOOL_NOT_FOUND",
            "未找到该开发工具配置，请重新选择。",
        ));
    }
    Ok(())
}

fn normalize_required(raw: &str, code: &str, message: &str) -> Result<String, AppError> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::new(code, message));
    }
    Ok(value.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<ProjectTool, AppError> {
    conn.query_row(&format!("{SELECT_SQL} WHERE pt.id = ?1"), [id], row_to_project_tool)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::new("PROJECT_TOOL_NOT_FOUND", "未找到该项目与工具的关联。")
            }
            other => other.into(),
        })
}

/// 查找项目与工具的关联；不存在时返回 `None`。
pub fn find(
    conn: &Connection,
    project_id: &str,
    tool_id: &str,
) -> Result<Option<ProjectTool>, AppError> {
    Ok(conn
        .query_row(
            &format!("{SELECT_SQL} WHERE pt.project_id = ?1 AND pt.tool_id = ?2"),
            params![project_id, tool_id],
            row_to_project_tool,
        )
        .optional()?)
}

/// 某个项目关联的全部工具。
pub fn list_for_project(conn: &Connection, project_id: &str) -> Result<Vec<ProjectTool>, AppError> {
    let sql = format!(
        "{SELECT_SQL} WHERE pt.project_id = ?1 ORDER BY pt.created_at ASC, pt.id ASC"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([project_id], row_to_project_tool)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

/// 某款工具关联的全部项目。
pub fn list_for_tool(conn: &Connection, tool_id: &str) -> Result<Vec<ProjectTool>, AppError> {
    let sql = format!("{SELECT_SQL} WHERE pt.tool_id = ?1 ORDER BY pt.created_at ASC, pt.id ASC");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([tool_id], row_to_project_tool)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

/// 建立（或返回已存在的）项目与工具的关联。
///
/// 项目与工具都必须存在；重复建立同一关联是幂等的，返回既有记录。
pub fn ensure(
    conn: &Connection,
    project_id_raw: &str,
    tool_id_raw: &str,
) -> Result<ProjectTool, AppError> {
    let project_id = normalize_required(
        project_id_raw,
        "PROJECT_TOOL_PROJECT_REQUIRED",
        "关联必须指定项目。",
    )?;
    let tool_id = normalize_required(
        tool_id_raw,
        "PROJECT_TOOL_TOOL_REQUIRED",
        "关联必须指定开发工具。",
    )?;

    // 两个引用都在后端重新校验，绝不只信任前端传入的 id。
    projects::get_project(conn, &project_id)?;
    ensure_tool_exists(conn, &tool_id)?;

    if let Some(existing) = find(conn, &project_id, &tool_id)? {
        return Ok(existing);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();
    conn.execute(
        "INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, project_id, tool_id, now],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // 唯一约束：并发或重复请求下已存在同一关联。
            AppError::new("PROJECT_TOOL_EXISTS", "该项目已关联该开发工具。")
        }
        other => other.into(),
    })?;
    get(conn, &id)
}

/// 删除一条关联；其下的会话记录由外键级联一并删除。
///
/// 如果被删除的关联正是项目的当前工具（`projects.default_tool_id`），则同时把
/// 当前工具置空，避免留下指向已删除关联的悬空引用；不会静默改指到其它工具。
pub fn remove(conn: &Connection, id: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    let target: Option<(String, String)> = tx
        .query_row(
            "SELECT project_id, tool_id FROM project_tools WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (project_id, tool_id) = target.ok_or_else(|| {
        AppError::new("PROJECT_TOOL_NOT_FOUND", "未找到该项目与工具的关联。")
    })?;
    tx.execute("DELETE FROM project_tools WHERE id = ?1", [id])?;
    tx.execute(
        "UPDATE projects SET default_tool_id = NULL, updated_at = ?1
         WHERE id = ?2 AND default_tool_id = ?3",
        params![crate::now_iso(), project_id, tool_id],
    )?;
    tx.commit()?;
    Ok(())
}
