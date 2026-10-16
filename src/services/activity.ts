/**
 * 活动记录相关后端命令的调用封装。
 *
 * 活动由后端在关键操作后写入；前端只负责查询与展示。
 */

import { invoke } from "@tauri-apps/api/core";
import type { ActivityFilter, ActivityPage } from "../types/domain";

/** 按条件分页读取活动记录（时间倒序）。 */
export function listActivity(filter: ActivityFilter = {}): Promise<ActivityPage> {
  return invoke<ActivityPage>("list_activity", { filter });
}

/** 清理活动记录：传入 projectId 只清理该项目的记录，否则清空全部。 */
export function clearActivity(projectId: string | null = null): Promise<number> {
  return invoke<number>("clear_activity", { projectId });
}
