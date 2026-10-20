use crate::error::AppError;
use crate::models::Project;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

/// Windows 文件系统不允许出现在文件名中的字符。
const INVALID_NAME_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Windows 保留设备名称（不区分大小写，且带扩展名时同样保留）。
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub(crate) const SELECT_COLUMNS: &str = "id, name, path, created_at, updated_at, last_opened_at, \
     description, is_favorite, default_tool_id";

pub(crate) fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let path: String = row.get("path")?;
    Ok(Project {
        path_exists: Path::new(&path).is_dir(),
        id: row.get("id")?,
        name: row.get("name")?,
        path,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_opened_at: row.get("last_opened_at")?,
        description: row.get("description")?,
        is_favorite: row.get::<_, i64>("is_favorite")? != 0,
        default_tool_id: row.get("default_tool_id")?,
    })
}

/// 校验并规范化项目显示名称。
pub fn validate_project_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();

    if name.is_empty() {
        return Err(AppError::new("PROJECT_NAME_EMPTY", "项目名称不能为空。"));
    }
    if name == "." || name == ".." {
        return Err(AppError::new(
            "PROJECT_NAME_INVALID",
            "项目名称不能为 . 或 ..。",
        ));
    }
    if name.chars().any(|c| c.is_control() || INVALID_NAME_CHARS.contains(&c)) {
        return Err(AppError::new(
            "PROJECT_NAME_INVALID_CHAR",
            "项目名称包含文件系统不允许的字符（< > : \" / \\ | ? *）。",
        ));
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err(AppError::new(
            "PROJECT_NAME_INVALID",
            "项目名称不能以空格或句点结尾。",
        ));
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(AppError::new(
            "PROJECT_NAME_RESERVED",
            "该项目名称为系统保留名称，请更换。",
        ));
    }
    if name.chars().count() > 120 {
        return Err(AppError::new(
            "PROJECT_NAME_TOO_LONG",
            "项目名称过长，请控制在 120 个字符以内。",
        ));
    }

    Ok(name.to_string())
}

/// 去除 Windows `\\?\` 扩展长度前缀，得到可读路径。
pub(crate) fn strip_extended_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

/// 校验路径指向一个存在且可访问的目录，返回规范化后的绝对路径。
pub fn normalize_existing_dir(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("PATH_EMPTY", "路径不能为空。"));
    }

    let path = PathBuf::from(trimmed);
    let metadata = std::fs::metadata(&path).map_err(|_| {
        AppError::new("PATH_NOT_FOUND", format!("目录不存在或不可访问：{trimmed}"))
    })?;

    if !metadata.is_dir() {
        return Err(AppError::new(
            "PATH_NOT_DIR",
            format!("所选路径不是目录：{trimmed}"),
        ));
    }

    let canonical = std::fs::canonicalize(&path).unwrap_or(path);
    Ok(strip_extended_prefix(&canonical).to_string_lossy().into_owned())
}

/// 查询项目列表。`sort` 支持 recent / created / name。
pub fn list_projects(conn: &Connection, sort: &str) -> Result<Vec<Project>, AppError> {
    let order_by = match sort {
        "name" => "name COLLATE NOCASE ASC",
        "created" => "created_at DESC",
        // 默认按最近访问：空值排在最后，其次按创建时间。
        _ => "last_opened_at IS NULL ASC, last_opened_at DESC, created_at DESC",
    };

    let sql = format!("SELECT {SELECT_COLUMNS} FROM projects ORDER BY {order_by}");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], row_to_project)?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, AppError> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM projects WHERE id = ?1"),
        [id],
        row_to_project,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。")
        }
        other => other.into(),
    })
}

fn path_registered(conn: &Connection, path: &str) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE path = ?1 COLLATE NOCASE",
        [path],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn insert_project(
    conn: &Connection,
    name: &str,
    path: &str,
    description: Option<&str>,
) -> Result<Project, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = crate::now_iso();

    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, updated_at, last_opened_at, description, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?4, NULL, ?5, 0)",
        params![id, name, path, now, description],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::new("PROJECT_DUPLICATE", "该项目路径已被登记。")
        }
        other => other.into(),
    })?;

    get_project(conn, &id)
}

/// 在指定父目录下创建新项目目录并登记。
pub fn create_project(
    conn: &Connection,
    name_raw: &str,
    location_raw: &str,
) -> Result<Project, AppError> {
    let name = validate_project_name(name_raw)?;
    let location = normalize_existing_dir(location_raw)?;
    let target = Path::new(&location).join(&name);

    if target.exists() {
        return Err(AppError::new(
            "TARGET_EXISTS",
            format!("目标目录已存在：{}", target.display()),
        ));
    }

    std::fs::create_dir(&target).map_err(|error| {
        AppError::new(
            "DIR_CREATE_FAILED",
            format!("无法创建项目目录 {}：{error}", target.display()),
        )
    })?;

    let target_path = strip_extended_prefix(
        &std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone()),
    )
    .to_string_lossy()
    .into_owned();

    if path_registered(conn, &target_path)? {
        let _ = std::fs::remove_dir(&target);
        return Err(AppError::new(
            "PROJECT_DUPLICATE",
            "该项目路径已被登记。",
        ));
    }

    match insert_project(conn, &name, &target_path, None) {
        Ok(project) => Ok(project),
        Err(error) => {
            // 数据库写入失败时回收刚创建的空目录，避免留下不一致状态。
            let _ = std::fs::remove_dir(&target);
            Err(error)
        }
    }
}

fn default_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "未命名项目".to_string())
}

/// 导入一个已存在的本地目录。
pub fn import_project(
    conn: &Connection,
    path_raw: &str,
    name_raw: Option<String>,
) -> Result<Project, AppError> {
    let path = normalize_existing_dir(path_raw)?;

    if path_registered(conn, &path)? {
        return Err(AppError::new(
            "PROJECT_DUPLICATE",
            "该目录已被登记为项目。",
        ));
    }

    let name = match name_raw {
        Some(value) if !value.trim().is_empty() => validate_project_name(&value)?,
        _ => default_name_from_path(&path),
    };

    insert_project(conn, &name, &path, None)
}

pub fn rename_project(conn: &Connection, id: &str, name_raw: &str) -> Result<Project, AppError> {
    let name = validate_project_name(name_raw)?;
    let now = crate::now_iso();
    let affected = conn.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now, id],
    )?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    get_project(conn, id)
}

pub fn update_description(
    conn: &Connection,
    id: &str,
    description: Option<String>,
) -> Result<Project, AppError> {
    let cleaned = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let now = crate::now_iso();
    let affected = conn.execute(
        "UPDATE projects SET description = ?1, updated_at = ?2 WHERE id = ?3",
        params![cleaned, now, id],
    )?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    get_project(conn, id)
}

/// 设置项目偏好的开发工具；`tool_id` 为 None 时清除。
///
/// 仅负责写入关联字段，工具是否有效由上层（`launch` 模块）校验。
pub fn set_default_tool(
    conn: &Connection,
    id: &str,
    tool_id: Option<&str>,
) -> Result<Project, AppError> {
    let now = crate::now_iso();
    let affected = conn.execute(
        "UPDATE projects SET default_tool_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![tool_id, now, id],
    )?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    get_project(conn, id)
}

pub fn set_favorite(conn: &Connection, id: &str, is_favorite: bool) -> Result<Project, AppError> {
    let now = crate::now_iso();
    let affected = conn.execute(
        "UPDATE projects SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
        params![if is_favorite { 1 } else { 0 }, now, id],
    )?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    get_project(conn, id)
}

/// 记录一次项目访问（例如打开项目详情）。
pub fn touch_opened(conn: &Connection, id: &str) -> Result<Project, AppError> {
    let now = crate::now_iso();
    let affected = conn.execute(
        "UPDATE projects SET last_opened_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    get_project(conn, id)
}

/// 仅移除数据库中的登记记录，不删除磁盘目录。
///
/// 同时删除该项目关联的任务与工作上下文记录（在同一事务内），避免留下不可访问的
/// 孤立数据。
pub fn remove_project(conn: &Connection, id: &str) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM tasks WHERE project_id = ?1", [id])?;
    tx.execute(
        "DELETE FROM workspace_sessions WHERE project_id = ?1",
        [id],
    )?;
    // 记忆文件元数据不含外键，需在删除项目前显式清理项目级登记，避免留下指向
    // 已不存在归属的孤立记录（磁盘文件保持不动）。会话级记忆已退役，不再有
    // owner_kind='session' 的有效写入路径，故不在此清理历史会话登记。
    tx.execute(
        "DELETE FROM memory_files WHERE owner_kind = 'project' AND owner_id = ?1",
        [id],
    )?;
    // 共享上下文引用入口登记表同样不含外键，需显式清理。
    tx.execute(
        "DELETE FROM context_reference_entries WHERE project_id = ?1",
        [id],
    )?;
    // 共享上下文的停用标记存于 app_settings（键含项目 ID），属纯元数据；
    // 仅清理该项目的键，不影响磁盘文件或用户内容。
    crate::shared_context::forget_disabled(&tx, id)?;
    let affected = tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::new("PROJECT_NOT_FOUND", "未找到该项目记录。"));
    }
    tx.commit()?;
    Ok(())
}

/// 大小写不敏感地比较两个路径是否指向同一位置（Windows 语义）。
pub(crate) fn paths_equal(a: &Path, b: &Path) -> bool {
    let normalize = |value: &Path| {
        value
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_owned()
    };
    let left = normalize(a);
    let right = normalize(b);
    if left.is_empty() || right.is_empty() {
        return left == right;
    }
    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

/// 判断路径是否含有可删除的叶子目录。
///
/// 用于拒绝磁盘根、UNC 共享根等只有前缀/根组件的路径，
/// 避免退化为对整个盘符或共享执行删除。
fn has_deletable_leaf(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, std::path::Component::Normal(_)))
}

/// 判断目标目录是否为受保护位置（系统目录、用户主目录、当前工作目录及其祖先）。
fn is_protected_dir(target: &Path) -> bool {
    const PROTECTED_ENV: &[&str] = &[
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
        "USERPROFILE",
        "PUBLIC",
        "APPDATA",
        "LOCALAPPDATA",
    ];

    let mut protected: Vec<PathBuf> = Vec::new();
    for key in PROTECTED_ENV {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() {
                let raw = PathBuf::from(value);
                let resolved = std::fs::canonicalize(&raw).unwrap_or(raw);
                protected.push(strip_extended_prefix(&resolved));
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let resolved = std::fs::canonicalize(&cwd).unwrap_or(cwd);
        protected.push(strip_extended_prefix(&resolved));
    }

    protected
        .iter()
        .any(|entry| paths_equal(target, entry) || entry.starts_with(target))
}

/// 删除磁盘上的项目目录。
///
/// 传入的 `stored_path` 必须来自数据库登记的项目路径（由后端按项目 ID 重新解析，
/// 绝不信任前端传入的路径）。只有在通过全部安全校验后才会执行递归删除，
/// 校验失败时直接报错，不会退化为无约束的 `remove_dir_all`。
pub fn delete_project_dir(stored_path: &str) -> Result<(), AppError> {
    let trimmed = stored_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("PATH_EMPTY", "项目路径为空，已拒绝删除。"));
    }

    let raw = PathBuf::from(trimmed);
    if !raw.is_absolute() {
        return Err(AppError::new(
            "PATH_NOT_ABSOLUTE",
            format!("项目路径不是绝对路径，已拒绝删除：{trimmed}"),
        ));
    }

    // 词法检查：拒绝磁盘根 / UNC 共享根。
    if !has_deletable_leaf(&raw) {
        return Err(AppError::new(
            "PATH_UNSAFE_ROOT",
            format!("拒绝删除根目录或磁盘根：{trimmed}"),
        ));
    }

    let metadata = std::fs::symlink_metadata(&raw).map_err(|_| {
        AppError::new(
            "PATH_NOT_FOUND",
            format!("项目目录不存在或不可访问：{trimmed}"),
        )
    })?;

    if metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "PATH_IS_LINK",
            format!("项目目录是符号链接或目录联接，已拒绝删除：{trimmed}"),
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::new(
            "PATH_NOT_DIR",
            format!("项目路径不是目录：{trimmed}"),
        ));
    }

    // 解析真实路径：识别路径穿越（..）、符号链接与目录联接。
    // 无法解析（例如已损坏的链接）时同样拒绝。
    let canonical_full = std::fs::canonicalize(&raw).map_err(|_| {
        AppError::new(
            "PATH_NOT_FOUND",
            format!("无法解析项目目录，已拒绝删除：{trimmed}"),
        )
    })?;
    let canonical = strip_extended_prefix(&canonical_full);
    let registered = strip_extended_prefix(&raw);

    if !paths_equal(&canonical, &registered) {
        return Err(AppError::new(
            "PROJECT_PATH_CHANGED",
            "项目目录已被移动、替换或指向了其它位置，已拒绝删除，请重新定位。",
        ));
    }

    if is_protected_dir(&canonical) {
        return Err(AppError::new(
            "PATH_UNSAFE",
            format!("拒绝删除受保护的系统或用户目录：{}", canonical.display()),
        ));
    }

    std::fs::remove_dir_all(&canonical).map_err(|error| {
        AppError::new(
            "DIR_DELETE_FAILED",
            format!("删除项目目录失败：{error}"),
        )
    })
}

/// 按指定范围移除项目。
///
/// `delete_dir` 为 `true` 时，先按项目 ID 从数据库取出可信路径并删除磁盘目录，
/// 只有磁盘删除成功后才移除数据库记录；删除失败则保留记录并返回错误，便于重试。
pub fn remove_project_with_scope(
    conn: &Connection,
    id: &str,
    delete_dir: bool,
) -> Result<(), AppError> {
    if delete_dir {
        let project = get_project(conn, id)?;
        delete_project_dir(&project.path)?;
    }
    remove_project(conn, id)
}

/// 将项目重新定位到新的本地目录（不改动磁盘文件）。
pub fn relocate_project(conn: &Connection, id: &str, path_raw: &str) -> Result<Project, AppError> {
    get_project(conn, id)?;
    let path = normalize_existing_dir(path_raw)?;

    let conflict: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE path = ?1 COLLATE NOCASE AND id <> ?2",
        params![path, id],
        |row| row.get(0),
    )?;
    if conflict > 0 {
        return Err(AppError::new(
            "PROJECT_DUPLICATE",
            "该目录已被其他项目登记。",
        ));
    }

    let now = crate::now_iso();
    conn.execute(
        "UPDATE projects SET path = ?1, updated_at = ?2 WHERE id = ?3",
        params![path, now, id],
    )?;
    get_project(conn, id)
}

/// 便捷读取：判断某个设置键是否存在（测试辅助）。
#[allow(dead_code)]
pub fn exists_by_path(conn: &Connection, path: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row(
            "SELECT id FROM projects WHERE path = ?1 COLLATE NOCASE",
            [path],
            |row| row.get(0),
        )
        .optional()?)
}
