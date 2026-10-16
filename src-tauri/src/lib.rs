use serde::Serialize;
use tauri::Manager;

pub mod backup;
pub mod commands;
pub mod db;
pub mod error;
pub mod health;
pub mod launch;
pub mod migrations;
pub mod models;
pub mod projects;
pub mod search;
pub mod settings;
pub mod shell;
pub mod tasks;
pub mod tools;
pub mod workspace;

/// 应用基础信息，返回给前端的只读结构。
#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

/// 生成 UTC ISO 8601 时间戳（毫秒精度），用于所有持久化时间字段。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 最小通信示例：接收前端传入的名称并返回问候语。
#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{name}！VibeAcross 的 Rust 后端已就绪。")
}

/// 返回应用名称、版本与所在平台，供前端展示。
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// 初始化数据库：数据目录位于系统应用数据目录下，绝不写入源码或安装目录。
fn init_database(app: &tauri::AppHandle) -> Result<db::Database, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    let database = db::Database::open(data_dir.join("vibeacross.db"))?;
    Ok(database)
}

/// 构建并运行 Tauri 应用。命令在此集中注册。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let database = init_database(app.handle())?;
            app.manage(database);
            // 受控启动所需的进程启动器与重复启动防抖状态。
            app.manage(launch::SystemLauncher::new());
            app.manage(launch::LaunchGuard::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            app_info,
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::import_project,
            commands::rename_project,
            commands::update_project_description,
            commands::set_project_favorite,
            commands::touch_project_opened,
            commands::relocate_project,
            commands::remove_project,
            commands::check_project_health,
            commands::open_project_dir,
            commands::set_project_tool,
            commands::launch_project,
            commands::get_settings,
            commands::update_settings,
            commands::get_storage_info,
            commands::suggested_backup_file_name,
            commands::create_backup,
            commands::inspect_backup,
            commands::restore_backup,
            commands::list_tools,
            commands::detect_tools,
            commands::revalidate_tool,
            commands::add_tool,
            commands::update_tool,
            commands::remove_tool,
            commands::set_default_tool,
            commands::resolve_tool_command,
            commands::list_tasks,
            commands::get_task,
            commands::create_task,
            commands::update_task,
            commands::set_task_status,
            commands::delete_task,
            commands::task_stats,
            commands::global_search,
            commands::list_workspace_sessions,
            commands::last_workspace_session,
            commands::create_workspace_session,
            commands::update_workspace_session,
            commands::delete_workspace_session,
            commands::restore_workspace_session,
        ])
        .run(tauri::generate_context!())
        .expect("启动 VibeAcross 应用时发生错误");
}
