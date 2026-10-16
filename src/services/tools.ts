/**
 * 工具相关后端命令的调用封装。
 *
 * 所有检测与持久化逻辑位于 Rust 侧，前端只负责调用命令与展示结果。
 * 所有变更命令都会返回最新的完整工具状态，避免额外的往返请求。
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolConfigInput, ToolState } from "../types/domain";

/** 读取当前工具状态（不触发新的系统检测）。 */
export function listTools(): Promise<ToolState> {
  return invoke<ToolState>("list_tools");
}

/** 触发检测；`toolId` 为空时进行全量检测。 */
export function detectTools(toolId?: string | null): Promise<ToolState> {
  return invoke<ToolState>("detect_tools", { toolId: toolId ?? null });
}

export function addTool(input: ToolConfigInput): Promise<ToolState> {
  return invoke<ToolState>("add_tool", { input });
}

export function updateTool(id: string, input: ToolConfigInput): Promise<ToolState> {
  return invoke<ToolState>("update_tool", { id, input });
}

export function removeTool(id: string): Promise<ToolState> {
  return invoke<ToolState>("remove_tool", { id });
}

/** 设置默认工具；传 null 表示清除默认工具。 */
export function setDefaultTool(id: string | null): Promise<ToolState> {
  return invoke<ToolState>("set_default_tool", { id });
}

/** 将命令名解析为可执行文件路径（用于表单预览）；无法解析时返回 null。 */
export function resolveToolCommand(command: string): Promise<string | null> {
  return invoke<string | null>("resolve_tool_command", { command });
}
