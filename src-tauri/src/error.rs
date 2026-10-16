use serde::Serialize;

/// 统一的后端错误类型。
///
/// 序列化后形如 `{ "code": "PROJECT_DUPLICATE", "message": "..." }`，
/// 前端可依据稳定的 `code` 做分支处理，并直接展示 `message`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(code, _) = &error {
            if code.code == rusqlite::ErrorCode::ConstraintViolation {
                return AppError::new("DB_CONSTRAINT", "数据违反唯一性或完整性约束。");
            }
        }
        AppError::new("DB_ERROR", format!("数据库操作失败：{error}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::new("IO_ERROR", format!("文件系统操作失败：{error}"))
    }
}
