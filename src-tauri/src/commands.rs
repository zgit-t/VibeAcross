use crate::backup::{BackupInfo, RestoreInfo};
use crate::db::Database;
use crate::error::AppError;
use crate::health::{self, ProjectHealth};
use crate::launch::{self, LaunchGuard, LaunchResult, SystemLauncher};
use crate::shell;
use crate::models::{
    AppSettings, CreateProjectInput, ImportProjectInput, Project, StorageInfo,
};
use crate::search::{self, SearchResults};
use crate::tasks::{self, Task, TaskInput, TaskQuery, TaskStats, TaskStatus};
use crate::tools::detect::SystemDetector;
use crate::tools::model::{ToolConfigInput, ToolState};
use crate::tools::service as tools;
use crate::workspace::{self, WorkspaceSession, WorkspaceSessionInput};
use crate::{projects, settings};
use std::path::Path;
use tauri::{Manager, State};

#[tauri::command]
pub fn list_projects(db: State<Database>, sort: Option<String>) -> Result<Vec<Project>, AppError> {
    let conn = db.conn()?;
    projects::list_projects(&conn, sort.as_deref().unwrap_or("recent"))
}

#[tauri::command]
pub fn get_project(db: State<Database>, id: String) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::get_project(&conn, &id)
}

#[tauri::command]
pub fn create_project(
    db: State<Database>,
    input: CreateProjectInput,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::create_project(&conn, &input.name, &input.location)
}

#[tauri::command]
pub fn import_project(
    db: State<Database>,
    input: ImportProjectInput,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::import_project(&conn, &input.path, input.name)
}

#[tauri::command]
pub fn rename_project(db: State<Database>, id: String, name: String) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::rename_project(&conn, &id, &name)
}

#[tauri::command]
pub fn update_project_description(
    db: State<Database>,
    id: String,
    description: Option<String>,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::update_description(&conn, &id, description)
}

#[tauri::command]
pub fn set_project_favorite(
    db: State<Database>,
    id: String,
    is_favorite: bool,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::set_favorite(&conn, &id, is_favorite)
}

#[tauri::command]
pub fn touch_project_opened(db: State<Database>, id: String) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::touch_opened(&conn, &id)
}

#[tauri::command]
pub fn relocate_project(
    db: State<Database>,
    id: String,
    path: String,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    projects::relocate_project(&conn, &id, &path)
}

#[tauri::command]
pub fn remove_project(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    projects::remove_project(&conn, &id)?;
    Ok(())
}

/// 按需检查一个项目的健康状态（项目路径健康与默认工具启动能力分开返回）。
#[tauri::command]
pub fn check_project_health(
    db: State<Database>,
    project_id: String,
    revalidate: Option<bool>,
) -> Result<ProjectHealth, AppError> {
    let conn = db.conn()?;
    health::project_health(
        &conn,
        &project_id,
        &SystemDetector::new(),
        revalidate.unwrap_or(false),
    )
}

/// 在系统文件管理器中打开项目目录（仅接受项目 id，路径由后端读取并校验）。
#[tauri::command]
pub fn open_project_dir(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    let project = projects::get_project(&conn, &id)?;
    shell::open_directory(Path::new(&project.path))
}

#[tauri::command]
pub fn set_project_tool(
    db: State<Database>,
    project_id: String,
    tool_id: Option<String>,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    launch::set_project_tool(
        &conn,
        &project_id,
        tool_id.as_deref(),
        &SystemDetector::new(),
    )
}

#[tauri::command]
pub fn launch_project(
    db: State<Database>,
    launcher: State<SystemLauncher>,
    guard: State<LaunchGuard>,
    project_id: String,
    tool_id: Option<String>,
) -> Result<LaunchResult, AppError> {
    let conn = db.conn()?;
    launch::launch(
        &conn,
        &*launcher,
        &guard,
        &project_id,
        tool_id.as_deref(),
        &SystemDetector::new(),
    )
}

#[tauri::command]
pub fn get_settings(db: State<Database>) -> Result<AppSettings, AppError> {
    let conn = db.conn()?;
    settings::get_settings(&conn)
}

#[tauri::command]
pub fn update_settings(
    db: State<Database>,
    settings_input: AppSettings,
) -> Result<AppSettings, AppError> {
    let conn = db.conn()?;
    settings::update_settings(&conn, settings_input)
}

#[tauri::command]
pub fn get_storage_info(app: tauri::AppHandle, db: State<Database>) -> Result<StorageInfo, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(StorageInfo {
        database_path: db.path().to_string_lossy().into_owned(),
        app_data_dir,
    })
}

/// 建议的备份文件名（可识别 + 专用扩展名），供前端文件对话框默认使用。
#[tauri::command]
pub fn suggested_backup_file_name() -> String {
    crate::backup::suggested_file_name()
}

/// 创建一致性备份到用户选择的位置；目标已存在时需 `overwrite` 明确覆盖。
#[tauri::command]
pub fn create_backup(
    db: State<Database>,
    target_path: String,
    overwrite: Option<bool>,
) -> Result<BackupInfo, AppError> {
    db.create_backup(Path::new(&target_path), overwrite.unwrap_or(false))
}

/// 只读校验一个备份文件，返回其版本与数据规模（不改动任何数据）。
#[tauri::command]
pub fn inspect_backup(path: String) -> Result<BackupInfo, AppError> {
    crate::backup::inspect_backup_file(Path::new(&path))
}

/// 从所选备份文件受控恢复；恢复前会自动创建保护性备份。
#[tauri::command]
pub fn restore_backup(db: State<Database>, source_path: String) -> Result<RestoreInfo, AppError> {
    db.restore_from(Path::new(&source_path))
}

#[tauri::command]
pub fn list_tools(db: State<Database>) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    tools::tool_state(&conn, &SystemDetector::new())
}

#[tauri::command]
pub fn detect_tools(db: State<Database>, tool_id: Option<String>) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    tools::detect_tools(&conn, &SystemDetector::new(), tool_id.as_deref())
}

/// 仅重新校验一条已保存的配置，不触发全量自动检测（不会产生重复条目）。
#[tauri::command]
pub fn revalidate_tool(db: State<Database>, id: String) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    tools::revalidate_tool(&conn, &SystemDetector::new(), &id)
}

#[tauri::command]
pub fn add_tool(db: State<Database>, input: ToolConfigInput) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    tools::add_tool(&conn, &detector, input)?;
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn update_tool(
    db: State<Database>,
    id: String,
    input: ToolConfigInput,
) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    tools::update_tool(&conn, &detector, &id, input)?;
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn remove_tool(db: State<Database>, id: String) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    tools::remove_tool(&conn, &id)?;
    // 清除指向已移除工具的项目关联，避免留下悬空引用。
    launch::clear_tool_references(&conn, &id)?;
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn set_default_tool(db: State<Database>, id: Option<String>) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    tools::set_default_tool(&conn, id.as_deref())?;
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn resolve_tool_command(command: String) -> Option<String> {
    tools::resolve_command(&SystemDetector::new(), &command)
}

#[tauri::command]
pub fn list_tasks(db: State<Database>, query: Option<TaskQuery>) -> Result<Vec<Task>, AppError> {
    let conn = db.conn()?;
    tasks::list_tasks(&conn, &query.unwrap_or_default())
}

#[tauri::command]
pub fn get_task(db: State<Database>, id: String) -> Result<Task, AppError> {
    let conn = db.conn()?;
    tasks::get_task(&conn, &id)
}

#[tauri::command]
pub fn create_task(db: State<Database>, input: TaskInput) -> Result<Task, AppError> {
    let conn = db.conn()?;
    tasks::create_task(&conn, input)
}

#[tauri::command]
pub fn update_task(db: State<Database>, id: String, input: TaskInput) -> Result<Task, AppError> {
    let conn = db.conn()?;
    tasks::update_task(&conn, &id, input)
}

#[tauri::command]
pub fn set_task_status(
    db: State<Database>,
    id: String,
    status: TaskStatus,
) -> Result<Task, AppError> {
    let conn = db.conn()?;
    tasks::set_task_status(&conn, &id, status)
}

#[tauri::command]
pub fn delete_task(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    tasks::delete_task(&conn, &id)?;
    Ok(())
}

#[tauri::command]
pub fn task_stats(db: State<Database>) -> Result<TaskStats, AppError> {
    let conn = db.conn()?;
    tasks::task_stats(&conn)
}

#[tauri::command]
pub fn global_search(
    db: State<Database>,
    query: String,
    limit: Option<u32>,
) -> Result<SearchResults, AppError> {
    let conn = db.conn()?;
    search::global_search(&conn, &query, limit)
}

#[tauri::command]
pub fn list_workspace_sessions(db: State<Database>) -> Result<Vec<WorkspaceSession>, AppError> {
    let conn = db.conn()?;
    workspace::list_sessions(&conn)
}

#[tauri::command]
pub fn last_workspace_session(db: State<Database>) -> Result<Option<WorkspaceSession>, AppError> {
    let conn = db.conn()?;
    workspace::last_session(&conn)
}

#[tauri::command]
pub fn create_workspace_session(
    db: State<Database>,
    input: WorkspaceSessionInput,
) -> Result<WorkspaceSession, AppError> {
    let conn = db.conn()?;
    workspace::create_session(&conn, &SystemDetector::new(), input)
}

#[tauri::command]
pub fn update_workspace_session(
    db: State<Database>,
    id: String,
    input: WorkspaceSessionInput,
) -> Result<WorkspaceSession, AppError> {
    let conn = db.conn()?;
    workspace::update_session(&conn, &SystemDetector::new(), &id, input)
}

#[tauri::command]
pub fn delete_workspace_session(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    workspace::delete_session(&conn, &id)?;
    Ok(())
}

/// 恢复工作上下文：重新启动所选工具并打开项目目录（复用 Phase 5 启动逻辑）。
#[tauri::command]
pub fn restore_workspace_session(
    db: State<Database>,
    launcher: State<SystemLauncher>,
    guard: State<LaunchGuard>,
    id: String,
    tool_id: Option<String>,
) -> Result<LaunchResult, AppError> {
    let conn = db.conn()?;
    workspace::restore_session(
        &conn,
        &*launcher,
        &guard,
        &SystemDetector::new(),
        &id,
        tool_id.as_deref(),
    )
    .map(|outcome| outcome.launch)
}
