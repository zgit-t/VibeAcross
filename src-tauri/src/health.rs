//! 项目健康检查：**项目路径健康** 与 **默认工具启动能力** 分开判定。
//!
//! 设计要点：
//!  - 只对数据库中已登记的项目按需检查：仅 stat 该项目自身目录（不递归、不扫描磁盘）。
//!  - 检查本身只读，不修改项目路径、不移动/复制/删除任何文件。
//!  - 默认工具的能力复用工具服务（`tools::service::tool_state`），与 Tools 页面口径一致。
//!  - 可选地重新校验默认工具路径（`revalidate_tool`），但仍不触发全量自动检测。

use crate::error::AppError;
use crate::models::Project;
use crate::projects;
use crate::tools::detect::Detector;
use crate::tools::model::LaunchSupport;
use crate::tools::service as tools;
use rusqlite::Connection;
use serde::Serialize;
use std::io::ErrorKind;
use std::path::Path;

/// 项目路径健康状态。序列化为 camelCase。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PathStatus {
    /// 存在、是目录且可枚举。
    Ok,
    /// 路径不存在（目录已被移动或删除）。
    Missing,
    /// 路径存在，但指向的不是目录（例如文件）。
    NotDirectory,
    /// 存在且为目录，但当前用户无权限访问。
    Inaccessible,
    /// 其他文件系统错误，无法明确归类。
    Unknown,
}

/// 默认工具的启动能力分类（只看当前已配置的默认工具，不展示全部工具）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolHealthStatus {
    /// 项目尚未设置默认工具。
    NotConfigured,
    /// 关联的默认工具配置已不存在（例如已被移除）。
    Missing,
    /// 默认工具当前不可用（路径失效 / 未安装 / 检测失败）。
    Unavailable,
    /// 默认工具已检测到，但当前启动方式不受支持或需要补充配置。
    NotLaunchable,
    /// 默认工具可用，可受控启动。
    Ready,
}

/// 单个项目的健康检查结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHealth {
    pub project_id: String,
    /// 项目路径健康状态（检查时即时计算）。
    pub path_status: PathStatus,
    /// 默认工具的启动能力分类。
    pub tool_status: ToolHealthStatus,
    /// 项目关联的默认工具安装 id；未设置时为 null。
    pub tool_id: Option<String>,
}

/// 将文件系统错误分类为路径健康状态（便于单元测试覆盖各分支）。
fn classify_io_error(kind: ErrorKind) -> PathStatus {
    match kind {
        ErrorKind::NotFound => PathStatus::Missing,
        ErrorKind::PermissionDenied => PathStatus::Inaccessible,
        _ => PathStatus::Unknown,
    }
}

/// 仅检查单一目录自身：存在性、是否为目录、是否可枚举（不递归、不扫描磁盘）。
pub fn inspect_path(path: &Path) -> PathStatus {
    match std::fs::metadata(path) {
        Ok(metadata) if !metadata.is_dir() => PathStatus::NotDirectory,
        Ok(_) => match std::fs::read_dir(path) {
            Ok(_) => PathStatus::Ok,
            Err(_) => PathStatus::Inaccessible,
        },
        Err(error) => classify_io_error(error.kind()),
    }
}

/// 对指定项目执行一次健康检查。
///
/// `revalidate_tool` 为 true 时，先在重新校验默认工具的路径（仅这一条已保存的配置，
/// 不触发全量自动检测），再计算健康状态；为 false 时只按当前数据库状态判定。
pub fn project_health(
    conn: &Connection,
    project_id: &str,
    detector: &dyn Detector,
    revalidate_tool: bool,
) -> Result<ProjectHealth, AppError> {
    let project: Project = projects::get_project(conn, project_id)?;
    let path_status = inspect_path(Path::new(&project.path));

    if revalidate_tool {
        if let Some(tool_id) = project.default_tool_id.as_deref() {
            match tools::revalidate_tool(conn, detector, tool_id) {
                Ok(_) => {}
                // 该配置没有可校验的路径 / 命令，或已被移除：不影响路径健康，继续判定。
                Err(error)
                    if error.code == "TOOL_CONFIG_REQUIRED" || error.code == "TOOL_NOT_FOUND" => {}
                Err(error) => return Err(error),
            }
        }
    }

    let state = tools::tool_state(conn, detector)?;
    let tool_status = match project.default_tool_id.as_deref() {
        None => ToolHealthStatus::NotConfigured,
        Some(id) => match state.entries.iter().find(|entry| entry.id == id) {
            None => ToolHealthStatus::Missing,
            Some(entry) => match entry.launch.support {
                LaunchSupport::Supported => ToolHealthStatus::Ready,
                LaunchSupport::Unavailable => ToolHealthStatus::Unavailable,
                LaunchSupport::NeedsConfiguration | LaunchSupport::Unsupported => {
                    ToolHealthStatus::NotLaunchable
                }
            },
        },
    };

    Ok(ProjectHealth {
        project_id: project.id,
        path_status,
        tool_status,
        tool_id: project.default_tool_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_error_kind_is_classified() {
        assert_eq!(classify_io_error(ErrorKind::NotFound), PathStatus::Missing);
        assert_eq!(
            classify_io_error(ErrorKind::PermissionDenied),
            PathStatus::Inaccessible
        );
        assert_eq!(
            classify_io_error(ErrorKind::Other),
            PathStatus::Unknown
        );
    }
}
