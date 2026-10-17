/**
 * AI 工具会话（原生会话）相关后端命令的调用封装。
 *
 * 约定：所有业务逻辑与校验都在 Rust 侧完成，前端只提交「项目 id / 工具安装 id /
 * 会话 id」这类标识，绝不传入任意命令、参数或路径。能力（创建 / 查询 / 恢复 /
 * 改名）由后端如实标注为「支持 / 不支持 / 尚未核实」，前端据此决定是否提供操作。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AiRenameOutcome,
  AiSession,
  AiSessionStatus,
  DeleteScope,
  LaunchResult,
  NativeCreateInput,
  NativeCreateOutcome,
  NativeSessionCapabilities,
  NativeSessionInfo,
  NativeSyncOutcome,
  SessionDeleteOutcome,
} from "../types/domain";

/** 会话列表查询条件。与 Rust 后端 `sessions::SessionQuery` 一致。 */
export interface AiSessionQuery {
  projectId?: string | null;
  toolId?: string | null;
  status?: AiSessionStatus | null;
}

/** 某款工具的原生会话能力矩阵（支持 / 不支持 / 尚未核实）。 */
export function sessionCapabilities(
  toolId: string,
): Promise<NativeSessionCapabilities> {
  return invoke<NativeSessionCapabilities>("session_capabilities", { toolId });
}

/** 枚举某项目在某工具下的原生历史会话（只读，不写入记录）。 */
export function listNativeSessions(
  projectId: string,
  toolId: string,
): Promise<NativeSessionInfo[]> {
  return invoke<NativeSessionInfo[]>("list_native_sessions", {
    projectId,
    toolId,
  });
}

/**
 * 将工具中的原生会话导入本地记录（幂等），返回数据源状态与同步后的本地会话列表。
 * 用于让本地记录与工具中的真实会话保持一致，从而支持改名持久化。
 */
export function syncNativeSessions(
  projectId: string,
  toolId: string,
): Promise<NativeSyncOutcome> {
  return invoke<NativeSyncOutcome>("sync_native_sessions", { projectId, toolId });
}

/** 在指定项目目录下创建真实原生会话，并（默认）立即在工具中打开。 */
export function createNativeSession(
  input: NativeCreateInput,
): Promise<NativeCreateOutcome> {
  return invoke<NativeCreateOutcome>("create_native_session", { input });
}

/** 恢复某条本地会话对应的原生会话；缺失时后端如实报错，绝不静默新建。 */
export function restoreNativeSession(id: string): Promise<LaunchResult> {
  return invoke<LaunchResult>("restore_native_session", { id });
}

/**
 * 重命名会话。`syncNative` 为真时同时修改原生标题（工具不支持则后端如实报错）；
 * 为假时只修改 VibeAcross 中的本地显示名称。
 */
export function renameNativeSession(
  id: string,
  displayName: string,
  syncNative: boolean,
): Promise<AiRenameOutcome> {
  return invoke<AiRenameOutcome>("rename_native_session", {
    id,
    displayName,
    syncNative,
  });
}

/** 查询本地会话记录（可按项目 / 工具 / 状态过滤）。 */
export function listSessions(query: AiSessionQuery = {}): Promise<AiSession[]> {
  return invoke<AiSession[]>("list_sessions", { query });
}

/** 设置本地会话状态（active / archived）。 */
export function setSessionStatus(
  id: string,
  status: AiSessionStatus,
): Promise<AiSession> {
  return invoke<AiSession>("set_session_status", { id, status });
}

/**
 * 按选定范围删除会话。范围与执行顺序全部由后端协调：
 *  - `"local"`：只清理 VibeAcross 本地记录，绝不调用原生删除；
 *  - `"native"`：只删除工具中的原生会话，保留本地记录；
 *  - `"both"`：先成功删除原生会话，再清理本地记录（原生失败则保留本地记录）。
 * 结果如实反映实际删除范围；工具不支持原生删除时后端会报错，绝不伪造能力。
 */
export function deleteSessionScoped(
  id: string,
  scope: DeleteScope,
): Promise<SessionDeleteOutcome> {
  return invoke<SessionDeleteOutcome>("delete_session_scoped", { id, scope });
}
