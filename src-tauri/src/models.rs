use serde::{Deserialize, Serialize};

/// 项目记录。字段以 camelCase 序列化给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// 规范化后的本地绝对路径。
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub description: Option<String>,
    pub is_favorite: bool,
    /// 该项目偏好的开发工具安装配置 id（`tool_installations.id`）；未设置时为 null。
    pub default_tool_id: Option<String>,
    /// 查询时即时计算：目录当前是否存在且为目录。
    pub path_exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    /// 父目录（必须已存在）。
    pub location: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectInput {
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_project_folder: Option<String>,
    pub theme: Option<String>,
    /// 启动时是否显示最近的工作上下文。默认关闭（由前端按安全默认值处理）。
    #[serde(default)]
    pub show_last_context_on_startup: bool,
    /// 启动时是否自动恢复上次的工作环境。默认为 false，只有用户明确开启才执行。
    #[serde(default)]
    pub auto_restore_last_context: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub database_path: String,
    pub app_data_dir: String,
}
