import type {
  AiSession,
  NativeSessionCapabilities,
  Project,
  ToolEntry,
} from "../../types/domain";

/** 「直接从最近会话打开指定历史会话」被阻止的原因。 */
export type OpenSessionBlockReason =
  | "projectGone"
  | "pathMissing"
  | "noNativeId"
  | "toolUnavailable"
  | "unsupported"
  | "checking";

export interface OpenSessionAvailability {
  canOpen: boolean;
  reason: OpenSessionBlockReason | null;
}

/**
 * 判断某条会话能否「直接打开」。
 *
 * 只有在以下条件全部满足时才允许：项目仍存在、目录可访问、对应工具已安装、
 * 会话具备原生标识、且后端如实标注该工具支持恢复指定会话（`restore === "supported"`）。
 * 能力尚未取到时按「检查中」处理并阻止确认——绝不在缺少依据时假定支持。
 */
export function sessionOpenability(
  session: AiSession,
  project: Project | null,
  tool: ToolEntry | null,
  capabilities: NativeSessionCapabilities | undefined,
): OpenSessionAvailability {
  if (!project) {
    return { canOpen: false, reason: "projectGone" };
  }
  if (!session.projectPathExists) {
    return { canOpen: false, reason: "pathMissing" };
  }
  if (!tool || !tool.installed) {
    return { canOpen: false, reason: "toolUnavailable" };
  }
  if (!session.nativeSessionId) {
    return { canOpen: false, reason: "noNativeId" };
  }
  if (!capabilities) {
    return { canOpen: false, reason: "checking" };
  }
  if (capabilities.restore !== "supported") {
    return { canOpen: false, reason: "unsupported" };
  }
  return { canOpen: true, reason: null };
}
