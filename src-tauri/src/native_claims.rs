//! 原生会话归属登记。
//!
//! 记录「某条工具原生会话由哪个 VibeAcross 项目身份认领」。这是解决「删除项目后，
//! 在相同路径重建同名项目时旧原生会话被错误归入新项目」的关键数据：项目身份是
//! VibeAcross 生成的 UUID，路径与名称都不可作为身份。
//!
//! 边界：
//!  - 只保存归属元数据（工具标识 + 原生会话标识 + 项目身份 + 认领时间），
//!    不保存任何对话内容、文件内容、密钥或令牌。
//!  - 归属登记**不随项目 / 工具删除而清除**（表本身不含外键），以便识别出
//!    「属于已移除项目」的原生会话，避免其被同路径新项目自动接管。
//!  - 认领是幂等的：已属于同一项目身份时原样返回；已被其它身份认领时不夺取。

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};

/// 查询某条原生会话当前被哪个项目身份认领。
pub fn owner_project(
    conn: &Connection,
    tool_id: &str,
    native_session_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT project_id FROM native_session_claims
             WHERE tool_id = ?1 AND native_session_id = ?2",
            params![tool_id, native_session_id],
            |row| row.get(0),
        )
        .optional()?)
}

/// 由「项目 × 工具关联」解析出（内置工具标识, 项目身份）。
///
/// 返回 `None` 表示关联不存在（例如刚被删除），调用方据此跳过登记。
pub fn association_identity(
    conn: &Connection,
    project_tool_id: &str,
) -> Result<Option<(String, String)>, AppError> {
    Ok(conn
        .query_row(
            "SELECT ti.tool_id, pt.project_id
             FROM project_tools pt
             JOIN tool_installations ti ON ti.id = pt.tool_id
             WHERE pt.id = ?1",
            [project_tool_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?)
}

/// 该原生会话是否可归入指定项目：要么尚未被认领，要么恰好属于该项目。
///
/// 已被**其它**项目身份（含已被移除的项目）认领时返回 `false`，同步时据此跳过，
/// 绝不静默改投新项目。
pub fn is_available_for(
    conn: &Connection,
    tool_id: &str,
    native_session_id: &str,
    project_id: &str,
) -> Result<bool, AppError> {
    match owner_project(conn, tool_id, native_session_id)? {
        None => Ok(true),
        Some(owner) => Ok(owner == project_id),
    }
}

/// 认领一条原生会话。
///
/// 语义：
///  - 未被认领：写入归属并返回 `true`；
///  - 已属于同一项目身份：幂等返回 `true`；
///  - 已被其它项目身份认领：不夺取，返回 `false`。
pub fn claim(
    conn: &Connection,
    tool_id: &str,
    native_session_id: &str,
    project_id: &str,
) -> Result<bool, AppError> {
    match owner_project(conn, tool_id, native_session_id)? {
        Some(owner) => Ok(owner == project_id),
        None => {
            conn.execute(
                "INSERT OR IGNORE INTO native_session_claims
                    (tool_id, native_session_id, project_id, claimed_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![tool_id, native_session_id, project_id, crate::now_iso()],
            )?;
            // 并发下可能由另一方先写入，重新读取以给出真实结果。
            Ok(owner_project(conn, tool_id, native_session_id)?.as_deref() == Some(project_id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn setup() -> Database {
        let db = Database::open_in_memory().unwrap();
        {
            let conn = db.conn().unwrap();
            // 建立一条项目 × 工具关联，便于解析身份。
            conn.execute_batch(
                "INSERT INTO projects (id, name, path, is_favorite, created_at, updated_at)
                     VALUES ('p1', 'P1', 'C:/proj', 0, 't', 't');
                 INSERT INTO tool_installations
                     (id, tool_id, name, tool_type, source, executable_path, status, created_at, updated_at)
                     VALUES ('ti1', 'opencode', 'OpenCode', 'cli', 'custom', 'C:/opencode.exe',
                             'ready', 't', 't');
                 INSERT INTO project_tools (id, project_id, tool_id, created_at, updated_at)
                     VALUES ('pt1', 'p1', 'ti1', 't', 't');",
            )
            .unwrap();
        }
        db
    }

    #[test]
    fn claim_is_idempotent_and_exclusive() {
        let db = setup();
        let conn = db.conn().unwrap();
        let (tool, resolved) = association_identity(&conn, "pt1").unwrap().unwrap();
        assert_eq!(tool, "opencode");
        assert_eq!(resolved, "p1");

        assert!(claim(&conn, &tool, "n1", "p1").unwrap());
        // 幂等：同一身份重复认领仍为 true。
        assert!(claim(&conn, &tool, "n1", "p1").unwrap());
        // 其它身份不得夺取。
        assert!(!claim(&conn, &tool, "n1", "p2").unwrap());
        assert_eq!(owner_project(&conn, &tool, "n1").unwrap().as_deref(), Some("p1"));
        assert!(is_available_for(&conn, &tool, "n1", "p1").unwrap());
        assert!(!is_available_for(&conn, &tool, "n1", "p2").unwrap());
        // 未被认领的会话对所有身份都可归入。
        assert!(is_available_for(&conn, &tool, "n2", "p2").unwrap());
    }

    #[test]
    fn association_identity_missing_and_owner_survives_removal() {
        let db = setup();
        let conn = db.conn().unwrap();

        // 关联不存在时解析为 None（调用方据此跳过登记）。
        assert!(association_identity(&conn, "missing").unwrap().is_none());

        let (tool, project) = association_identity(&conn, "pt1").unwrap().unwrap();
        assert!(claim(&conn, &tool, "n9", &project).unwrap());

        // 删除「项目 × 工具」关联后，归属登记仍保留：可识别「已移除项目」的会话，
        // 使其不被其它身份（含同路径新项目）自动接管。
        conn.execute("DELETE FROM project_tools WHERE id = 'pt1'", [])
            .unwrap();
        assert_eq!(
            owner_project(&conn, &tool, "n9").unwrap().as_deref(),
            Some("p1")
        );
        assert!(!is_available_for(&conn, &tool, "n9", "p2").unwrap());
        // 原项目身份仍可幂等认领。
        assert!(claim(&conn, &tool, "n9", &project).unwrap());
    }
}
