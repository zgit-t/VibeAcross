/**
 * 任务相关后端命令的调用封装。
 *
 * 所有校验与持久化逻辑位于 Rust 侧；前端只负责调用命令与展示结果。
 */

import { invoke } from "@tauri-apps/api/core";
import type { Task, TaskInput, TaskQuery, TaskStats, TaskStatus } from "../types/domain";

/** 按条件读取任务列表。 */
export function listTasks(query: TaskQuery = {}): Promise<Task[]> {
  return invoke<Task[]>("list_tasks", { query });
}

export function getTask(id: string): Promise<Task> {
  return invoke<Task>("get_task", { id });
}

export function createTask(input: TaskInput): Promise<Task> {
  return invoke<Task>("create_task", { input });
}

export function updateTask(id: string, input: TaskInput): Promise<Task> {
  return invoke<Task>("update_task", { id, input });
}

/** 切换任务状态：完成写入完成时间，重新打开则清空。 */
export function setTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  return invoke<Task>("set_task_status", { id, status });
}

export function deleteTask(id: string): Promise<void> {
  return invoke<void>("delete_task", { id });
}

/** 读取全局任务统计。 */
export function taskStats(): Promise<TaskStats> {
  return invoke<TaskStats>("task_stats");
}
