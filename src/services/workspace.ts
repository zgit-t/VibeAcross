/**
 * 工作上下文相关后端命令的调用封装（Phase 7）。
 *
 * 恢复只复用后端的受控启动逻辑；前端只提交「上下文 id + 可选工具安装 id」，
 * 绝不传入任意命令或参数。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  LaunchResult,
  WorkspaceSession,
  WorkspaceSessionInput,
} from "../types/domain";

/** 按最近使用排序读取全部工作上下文。 */
export function listWorkspaceSessions(): Promise<WorkspaceSession[]> {
  return invoke<WorkspaceSession[]>("list_workspace_sessions");
}

/** 最近一次使用的工作上下文；从未恢复过时取最近更新的记录。 */
export function lastWorkspaceSession(): Promise<WorkspaceSession | null> {
  return invoke<WorkspaceSession | null>("last_workspace_session");
}

export function createWorkspaceSession(
  input: WorkspaceSessionInput,
): Promise<WorkspaceSession> {
  return invoke<WorkspaceSession>("create_workspace_session", { input });
}

export function updateWorkspaceSession(
  id: string,
  input: WorkspaceSessionInput,
): Promise<WorkspaceSession> {
  return invoke<WorkspaceSession>("update_workspace_session", { id, input });
}

export function deleteWorkspaceSession(id: string): Promise<void> {
  return invoke<void>("delete_workspace_session", { id });
}

/** 恢复上下文：启动所选工具并打开项目目录。 */
export function restoreWorkspaceSession(
  id: string,
  toolId?: string | null,
): Promise<LaunchResult> {
  return invoke<LaunchResult>("restore_workspace_session", {
    id,
    toolId: toolId ?? null,
  });
}
