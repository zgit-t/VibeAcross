//! 阶段 05：全局搜索的只读查询。
//!
//! 只检索应用数据库中的**已有字段**（项目名称 / 备注、任务标题 / 描述、工作上下文
//! 中的名称 / 项目名 / 工具名 / 任务标题），不扫描项目源代码、不递归读取用户文件。
//! 采用 `LIKE` 子串匹配（ASCII 大小写不敏感），并转义 `%` / `_` / `\`；数据量很小，
//! 因此不引入全文检索基础设施。
//!
//! 已删除或无效关联的记录不会被当作有效结果：任务通过 `JOIN projects` 排除孤儿；
//! 工作上下文要求所属项目仍然存在。每类结果都有稳定排序与上限，保证结果可预测。

use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::Project;
use crate::tasks::Task;
use crate::workspace::WorkspaceSession;

/// 每类结果的默认上限。
pub const DEFAULT_LIMIT: u32 = 10;
/// 每类结果的硬上限。
pub const MAX_LIMIT: u32 = 25;

/// 任务搜索结果：任务本体 + 所属项目信息（用于展示与导航）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSearchResult {
    pub task: Task,
    pub project_name: String,
    pub project_path_exists: bool,
}

/// 全局搜索结果，按类型分组。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    /// 归一化后的查询词（前后空白已去除）；空查询时为 `""`。
    pub query: String,
    pub projects: Vec<Project>,
    pub tasks: Vec<TaskSearchResult>,
    pub sessions: Vec<WorkspaceSession>,
}

/// 归一化查询词：去除前后空白；空串返回 `None`。
pub fn normalize_term(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 把上限限制在 `1..=MAX_LIMIT`。
fn clamp_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

/// 构造 `%term%` 形式的安全匹配串。
fn pattern_for(term: &str) -> String {
    format!("%{}%", crate::tasks::escape_like(term))
}

fn search_projects(
    conn: &Connection,
    pattern: &str,
    limit: u32,
) -> Result<Vec<Project>, AppError> {
    let sql = format!(
        "SELECT {} FROM projects \
         WHERE name LIKE ?1 ESCAPE '\\' \
            OR IFNULL(description, '') LIKE ?1 ESCAPE '\\' \
         ORDER BY name COLLATE NOCASE ASC, id ASC \
         LIMIT ?2",
        crate::projects::SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![pattern, limit], crate::projects::row_to_project)?;
    collect(rows)
}

fn search_tasks(
    conn: &Connection,
    pattern: &str,
    limit: u32,
) -> Result<Vec<TaskSearchResult>, AppError> {
    // 通过 JOIN 项目排除所属项目已不存在（孤儿）的任务。
    let sql = "SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority, \
                      t.due_date, t.created_at, t.updated_at, t.completed_at, \
                      p.name AS project_name, p.path AS project_path \
               FROM tasks t \
               JOIN projects p ON p.id = t.project_id \
               WHERE t.title LIKE ?1 ESCAPE '\\' \
                  OR IFNULL(t.description, '') LIKE ?1 ESCAPE '\\' \
               ORDER BY t.updated_at DESC, t.id ASC \
               LIMIT ?2";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![pattern, limit], |row| {
        let task = crate::tasks::row_to_task(row)?;
        let project_path: String = row.get("project_path")?;
        Ok(TaskSearchResult {
            task,
            project_name: row.get("project_name")?,
            project_path_exists: Path::new(&project_path).is_dir(),
        })
    })?;
    collect(rows)
}

fn search_sessions(
    conn: &Connection,
    pattern: &str,
    limit: u32,
) -> Result<Vec<WorkspaceSession>, AppError> {
    // 复用工作上下文的联表查询；要求所属项目仍存在（排除已删除关联）。
    let sql = format!(
        "{} WHERE p.id IS NOT NULL \
            AND (w.label LIKE ?1 ESCAPE '\\' \
                 OR p.name LIKE ?1 ESCAPE '\\' \
                 OR t.name LIKE ?1 ESCAPE '\\' \
                 OR k.title LIKE ?1 ESCAPE '\\') \
         ORDER BY w.last_used_at IS NULL ASC, w.last_used_at DESC, \
                  w.updated_at DESC, w.id ASC \
         LIMIT ?2",
        crate::workspace::SELECT_SQL
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![pattern, limit], crate::workspace::row_to_session)?;
    collect(rows)
}

fn collect<T, F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<T>, AppError>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// 执行全局搜索。空查询返回空结果（不产生数据库查询）。
pub fn global_search(
    conn: &Connection,
    raw_query: &str,
    limit: Option<u32>,
) -> Result<SearchResults, AppError> {
    let Some(term) = normalize_term(raw_query) else {
        return Ok(SearchResults {
            query: String::new(),
            projects: Vec::new(),
            tasks: Vec::new(),
            sessions: Vec::new(),
        });
    };
    let limit = clamp_limit(limit);
    let pattern = pattern_for(&term);

    Ok(SearchResults {
        projects: search_projects(conn, &pattern, limit)?,
        tasks: search_tasks(conn, &pattern, limit)?,
        sessions: search_sessions(conn, &pattern, limit)?,
        query: term,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_term_trims_and_rejects_blank() {
        assert_eq!(normalize_term("  hi  "), Some("hi".to_string()));
        assert_eq!(normalize_term("   "), None);
        assert_eq!(normalize_term(""), None);
    }

    #[test]
    fn clamp_limit_bounds() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(1000)), MAX_LIMIT);
        assert_eq!(clamp_limit(Some(3)), 3);
    }

    #[test]
    fn pattern_escapes_like_wildcards() {
        assert_eq!(pattern_for("50%_off"), "%50\\%\\_off%");
    }
}
