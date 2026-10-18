/**
 * 后端命令的调用封装。
 *
 * 约定：所有业务逻辑位于 Rust 侧，前端只负责调用命令、展示结果与错误。
 * 这些函数仅在 Tauri 桌面运行时可用；纯浏览器开发模式下调用会失败。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  LaunchResult,
  Project,
  ProjectHealth,
  ProjectSort,
} from "../types/domain";

export interface CreateProjectInput {
  name: string;
  /** 父目录，必须已存在。 */
  location: string;
}

export interface ImportProjectInput {
  path: string;
  name?: string | null;
}

/** 按指定排序读取全部项目。 */
export function listProjects(sort: ProjectSort = "recent"): Promise<Project[]> {
  return invoke<Project[]>("list_projects", { sort });
}

export function getProject(id: string): Promise<Project> {
  return invoke<Project>("get_project", { id });
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return invoke<Project>("create_project", { input });
}

export function importProject(input: ImportProjectInput): Promise<Project> {
  return invoke<Project>("import_project", { input });
}

export function renameProject(id: string, name: string): Promise<Project> {
  return invoke<Project>("rename_project", { id, name });
}

export function updateProjectDescription(
  id: string,
  description: string | null,
): Promise<Project> {
  return invoke<Project>("update_project_description", { id, description });
}

export function setProjectFavorite(
  id: string,
  isFavorite: boolean,
): Promise<Project> {
  return invoke<Project>("set_project_favorite", { id, isFavorite });
}

export function touchProjectOpened(id: string): Promise<Project> {
  return invoke<Project>("touch_project_opened", { id });
}

export function relocateProject(id: string, path: string): Promise<Project> {
  return invoke<Project>("relocate_project", { id, path });
}

/** 移除项目。`deleteFolder` 为真时同时删除磁盘上的项目目录。 */
export function removeProject(id: string, deleteFolder = false): Promise<void> {
  return invoke<void>("remove_project", { id, deleteFolder });
}

/** 设置或清除项目的默认开发工具。传入 null 表示清除关联。 */
export function setProjectTool(
  id: string,
  toolId: string | null,
): Promise<Project> {
  return invoke<Project>("set_project_tool", { projectId: id, toolId });
}

/** 在项目目录中启动指定工具；`toolId` 为 null 时使用项目已保存的默认工具。 */
export function launchProject(
  id: string,
  toolId: string | null,
): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_project", { projectId: id, toolId });
}

/**
 * 按需检查项目健康状态。
 * `revalidate` 为 true 时先重新校验默认工具路径（不触发全量自动检测）。
 */
export function checkProjectHealth(
  id: string,
  revalidate = false,
): Promise<ProjectHealth> {
  return invoke<ProjectHealth>("check_project_health", {
    projectId: id,
    revalidate,
  });
}

/** 在系统文件管理器中打开项目目录（后端按项目 id 读取并校验路径）。 */
export function openProjectDir(id: string): Promise<void> {
  return invoke<void>("open_project_dir", { id });
}
