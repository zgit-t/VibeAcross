use crate::{error::AppError, migrations};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// SQLite 连接的受控封装。
///
/// 使用 `Mutex<Connection>` 串行化访问，避免并发写入造成不一致。
/// 本地桌面场景下查询量很小，串行访问是安全且足够的选择。
pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    /// 打开（必要时创建）位于指定路径的数据库，并执行迁移。
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::new(
                    "DB_DIR_CREATE_FAILED",
                    format!("无法创建数据目录 {}：{error}", parent.display()),
                )
            })?;
        }

        let conn = Connection::open(&path).map_err(|error| {
            AppError::new("DB_OPEN_FAILED", format!("无法打开数据库：{error}"))
        })?;

        Self::prepare(&conn)?;
        migrations::run(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    /// 内存数据库，仅用于测试。
    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()
            .map_err(|error| AppError::new("DB_OPEN_FAILED", format!("无法创建内存数据库：{error}")))?;
        Self::prepare(&conn)?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: PathBuf::from(":memory:"),
        })
    }

    fn prepare(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )?;

        // journal_mode 会返回一行结果，单独消费。
        let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;

        // 快速完整性校验，尽早发现损坏的数据库文件。
        let integrity: String =
            conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err(AppError::new(
                "DB_CORRUPTED",
                "数据库文件校验失败，可能已损坏。",
            ));
        }

        Ok(())
    }

    /// 获取数据库连接；持有期间会串行化所有访问。
    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.conn.lock().map_err(|_| {
            AppError::new("DB_LOCK_FAILED", "数据库连接状态异常，请重启应用后重试。")
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
