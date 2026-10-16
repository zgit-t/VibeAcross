use crate::activity::{self, ActivityFilter, ActivityPage, ActivityType};
use crate::db::Database;
use crate::error::AppError;
use crate::launch::{self, LaunchGuard, LaunchResult, SystemLauncher};
use crate::models::{
    AppSettings, CreateProjectInput, ImportProjectInput, Project, StorageInfo,
};
use crate::tasks::{self, Task, TaskInput, TaskQuery, TaskStats, TaskStatus};
use crate::tools::catalog;
use crate::tools::detect::SystemDetector;
use crate::tools::model::{ToolConfigInput, ToolState};
use crate::tools::service as tools;
use crate::workspace::{self, WorkspaceSession, WorkspaceSessionInput};
use crate::{projects, settings};
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
    let project = projects::create_project(&conn, &input.name, &input.location)?;
    activity::record_quietly(
        &conn,
        ActivityType::Project,
        Some(&project.id),
        &format!("创建项目「{}」", project.name),
    );
    Ok(project)
}

#[tauri::command]
pub fn import_project(
    db: State<Database>,
    input: ImportProjectInput,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    let project = projects::import_project(&conn, &input.path, input.name)?;
    activity::record_quietly(
        &conn,
        ActivityType::Project,
        Some(&project.id),
        &format!("导入项目「{}」", project.name),
    );
    Ok(project)
}

#[tauri::command]
pub fn rename_project(db: State<Database>, id: String, name: String) -> Result<Project, AppError> {
    let conn = db.conn()?;
    let before = projects::get_project(&conn, &id)?;
    let project = projects::rename_project(&conn, &id, &name)?;
    if before.name != project.name {
        activity::record_quietly(
            &conn,
            ActivityType::Project,
            Some(&project.id),
            &format!("将项目重命名为「{}」", project.name),
        );
    }
    Ok(project)
}

#[tauri::command]
pub fn update_project_description(
    db: State<Database>,
    id: String,
    description: Option<String>,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    let before = projects::get_project(&conn, &id)?;
    let project = projects::update_description(&conn, &id, description)?;
    if before.description != project.description {
        // 不记录备注内容，避免把可能敏感的用户文本写入历史。
        activity::record_quietly(
            &conn,
            ActivityType::Project,
            Some(&project.id),
            &format!("更新了项目「{}」的备注", project.name),
        );
    }
    Ok(project)
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
    let project = projects::relocate_project(&conn, &id, &path)?;
    activity::record_quietly(
        &conn,
        ActivityType::Project,
        Some(&project.id),
        &format!("重新定位项目「{}」的目录", project.name),
    );
    Ok(project)
}

#[tauri::command]
pub fn remove_project(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    let project = projects::get_project(&conn, &id)?;
    projects::remove_project(&conn, &id)?;
    activity::record_quietly(
        &conn,
        ActivityType::Project,
        Some(&id),
        &format!("移除项目「{}」", project.name),
    );
    Ok(())
}

#[tauri::command]
pub fn set_project_tool(
    db: State<Database>,
    project_id: String,
    tool_id: Option<String>,
) -> Result<Project, AppError> {
    let conn = db.conn()?;
    let tool_name = tool_id
        .as_deref()
        .and_then(|id| tools::install_name(&conn, id));
    let project = launch::set_project_tool(
        &conn,
        &project_id,
        tool_id.as_deref(),
        &SystemDetector::new(),
    )?;
    let summary = match tool_name {
        Some(name) => format!("将项目「{}」的默认工具设为「{name}」", project.name),
        None => format!("清除了项目「{}」的默认工具", project.name),
    };
    activity::record_quietly(&conn, ActivityType::Tool, Some(&project.id), &summary);
    Ok(project)
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
    let result = launch::launch(
        &conn,
        &*launcher,
        &guard,
        &project_id,
        tool_id.as_deref(),
        &SystemDetector::new(),
    )?;
    // 仅记录可确认的事实：进程已创建，不代表工具已完成初始化。
    activity::record_quietly(
        &conn,
        ActivityType::Tool,
        Some(&result.project_id),
        &format!(
            "在项目「{}」中启动工具「{}」（进程已创建）",
            result.project_name, result.tool_name
        ),
    );
    Ok(result)
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
    let previous = settings::get_settings(&conn)?;
    let updated = settings::update_settings(&conn, settings_input)?;
    // 仅当工作环境恢复相关设置发生变化时记录一次，避免重复记录。
    if previous.show_last_context_on_startup != updated.show_last_context_on_startup
        || previous.auto_restore_last_context != updated.auto_restore_last_context
    {
        activity::record_quietly(&conn, ActivityType::System, None, "更新工作环境恢复设置");
    }
    Ok(updated)
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

#[tauri::command]
pub fn add_tool(db: State<Database>, input: ToolConfigInput) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    // 在移动 input 之前解析用于活动记录的显示名称。
    let display_name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            input
                .tool_id
                .as_deref()
                .and_then(catalog::find)
                .map(|definition| definition.name.to_string())
        })
        .unwrap_or_else(|| "自定义工具".to_string());
    tools::add_tool(&conn, &detector, input)?;
    activity::record_quietly(
        &conn,
        ActivityType::Tool,
        None,
        &format!("添加开发工具「{display_name}」"),
    );
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
    let display_name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| tools::install_name(&conn, &id))
        .unwrap_or_else(|| "开发工具".to_string());
    tools::update_tool(&conn, &detector, &id, input)?;
    activity::record_quietly(
        &conn,
        ActivityType::Tool,
        None,
        &format!("更新开发工具「{display_name}」的配置"),
    );
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn remove_tool(db: State<Database>, id: String) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    let display_name = tools::install_name(&conn, &id);
    tools::remove_tool(&conn, &id)?;
    // 清除指向已移除工具的项目关联，避免留下悬空引用。
    launch::clear_tool_references(&conn, &id)?;
    if let Some(name) = display_name {
        activity::record_quietly(
            &conn,
            ActivityType::Tool,
            None,
            &format!("移除开发工具「{name}」"),
        );
    }
    tools::tool_state(&conn, &detector)
}

#[tauri::command]
pub fn set_default_tool(db: State<Database>, id: Option<String>) -> Result<ToolState, AppError> {
    let conn = db.conn()?;
    let detector = SystemDetector::new();
    let name = id.as_deref().and_then(|value| tools::install_name(&conn, value));
    tools::set_default_tool(&conn, id.as_deref())?;
    let summary = match name {
        Some(name) => format!("将默认开发工具设为「{name}」"),
        None => "清除了默认开发工具".to_string(),
    };
    activity::record_quietly(&conn, ActivityType::Tool, None, &summary);
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
    let task = tasks::create_task(&conn, input)?;
    activity::record_quietly(
        &conn,
        ActivityType::Task,
        Some(&task.project_id),
        &format!("创建任务「{}」", task.title),
    );
    Ok(task)
}

#[tauri::command]
pub fn update_task(db: State<Database>, id: String, input: TaskInput) -> Result<Task, AppError> {
    let conn = db.conn()?;
    let task = tasks::update_task(&conn, &id, input)?;
    activity::record_quietly(
        &conn,
        ActivityType::Task,
        Some(&task.project_id),
        &format!("更新任务「{}」", task.title),
    );
    Ok(task)
}

#[tauri::command]
pub fn set_task_status(
    db: State<Database>,
    id: String,
    status: TaskStatus,
) -> Result<Task, AppError> {
    let conn = db.conn()?;
    let before = tasks::get_task(&conn, &id)?;
    let task = tasks::set_task_status(&conn, &id, status)?;
    if before.status != task.status {
        let summary = match task.status {
            TaskStatus::Done => format!("完成任务「{}」", task.title),
            TaskStatus::InProgress => format!("将任务「{}」标记为进行中", task.title),
            TaskStatus::Todo => format!("重新打开任务「{}」", task.title),
        };
        activity::record_quietly(&conn, ActivityType::Task, Some(&task.project_id), &summary);
    }
    Ok(task)
}

#[tauri::command]
pub fn delete_task(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    let task = tasks::get_task(&conn, &id)?;
    tasks::delete_task(&conn, &id)?;
    activity::record_quietly(
        &conn,
        ActivityType::Task,
        Some(&task.project_id),
        &format!("删除任务「{}」", task.title),
    );
    Ok(())
}

#[tauri::command]
pub fn task_stats(db: State<Database>) -> Result<TaskStats, AppError> {
    let conn = db.conn()?;
    tasks::task_stats(&conn)
}

#[tauri::command]
pub fn list_activity(
    db: State<Database>,
    filter: Option<ActivityFilter>,
) -> Result<ActivityPage, AppError> {
    let conn = db.conn()?;
    activity::list_activity(&conn, &filter.unwrap_or_default())
}

#[tauri::command]
pub fn clear_activity(db: State<Database>, project_id: Option<String>) -> Result<u64, AppError> {
    let conn = db.conn()?;
    activity::clear_activity(&conn, project_id.as_deref())
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
    let session = workspace::create_session(&conn, &SystemDetector::new(), input)?;
    let name = session
        .label
        .clone()
        .or_else(|| session.project_name.clone())
        .unwrap_or_else(|| "项目".to_string());
    activity::record_quietly(
        &conn,
        ActivityType::System,
        Some(&session.project_id),
        &format!("保存工作上下文「{name}」"),
    );
    Ok(session)
}

#[tauri::command]
pub fn update_workspace_session(
    db: State<Database>,
    id: String,
    input: WorkspaceSessionInput,
) -> Result<WorkspaceSession, AppError> {
    let conn = db.conn()?;
    let session = workspace::update_session(&conn, &SystemDetector::new(), &id, input)?;
    let name = session
        .label
        .clone()
        .or_else(|| session.project_name.clone())
        .unwrap_or_else(|| "项目".to_string());
    activity::record_quietly(
        &conn,
        ActivityType::System,
        Some(&session.project_id),
        &format!("更新工作上下文「{name}」"),
    );
    Ok(session)
}

#[tauri::command]
pub fn delete_workspace_session(db: State<Database>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    let existing = workspace::get_session(&conn, &id).ok();
    workspace::delete_session(&conn, &id)?;
    if let Some(session) = existing {
        let name = session
            .label
            .clone()
            .or_else(|| session.project_name.clone())
            .unwrap_or_else(|| "项目".to_string());
        activity::record_quietly(
            &conn,
            ActivityType::System,
            Some(&session.project_id),
            &format!("删除工作上下文「{name}」"),
        );
    }
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
    match workspace::restore_session(
        &conn,
        &*launcher,
        &guard,
        &SystemDetector::new(),
        &id,
        tool_id.as_deref(),
    ) {
        Ok(outcome) => {
            let name = outcome
                .session
                .label
                .clone()
                .or_else(|| outcome.session.project_name.clone())
                .unwrap_or_else(|| "项目".to_string());
            activity::record_quietly(
                &conn,
                ActivityType::System,
                Some(&outcome.session.project_id),
                &format!(
                    "恢复工作上下文「{name}」：启动「{}」（进程已创建）",
                    outcome.launch.tool_name
                ),
            );
            Ok(outcome.launch)
        }
        Err(error) => {
            // 失败也记录，使用数据库中已脱敏的原因，明确标记为失败。
            let stored = workspace::get_session(&conn, &id).ok();
            let (project_id, reason) = match &stored {
                Some(session) => (
                    Some(session.project_id.clone()),
                    session
                        .last_restore_error
                        .clone()
                        .unwrap_or_else(|| "恢复失败".to_string()),
                ),
                None => (None, "恢复失败".to_string()),
            };
            activity::record_quietly(
                &conn,
                ActivityType::System,
                project_id.as_deref(),
                &format!("恢复工作上下文失败：{reason}"),
            );
            Err(error)
        }
    }
}
