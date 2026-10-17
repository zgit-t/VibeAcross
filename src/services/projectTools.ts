/**
 * 「项目 × 工具」关联相关后端命令的调用封装。
 *
 * 关联是会话的归属容器：一个项目可以关联多款 AI 工具，每款工具的会话相互独立。
 * 建立 / 删除关联都在后端重新校验项目与工具是否存在；删除关联会级联删除其下的
 * 本地会话记录（不影响工具内部的原生会话）。
 */

import { invoke } from "@tauri-apps/api/core";
import type { ProjectTool } from "../types/domain";

/** 某个项目关联的全部工具。 */
export function listProjectTools(projectId: string): Promise<ProjectTool[]> {
  return invoke<ProjectTool[]>("list_project_tools", { projectId });
}

/** 建立（或返回已存在的）项目 × 工具关联；重复建立是幂等的。 */
export function addProjectTool(
  projectId: string,
  toolId: string,
): Promise<ProjectTool> {
  return invoke<ProjectTool>("add_project_tool", {
    input: { projectId, toolId },
  });
}

/** 删除一条项目 × 工具关联；其下的本地会话记录随之删除。 */
export function removeProjectTool(id: string): Promise<void> {
  return invoke<void>("remove_project_tool", { id });
}
