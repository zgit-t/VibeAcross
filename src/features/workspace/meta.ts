import type {
  RestoreLevel,
  RestoreStatus,
  SessionResumeSupport,
  ToolEntry,
  WorkspaceSession,
} from "../../types/domain";

/** 徽标色调，与 `components/ui/Badge` 保持一致。 */
export type WorkspaceTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 恢复层级 → 中文标签。 */
export const RESTORE_LEVEL_LABEL: Record<RestoreLevel, string> = {
  none: "不支持恢复",
  project: "项目恢复 · Level 1",
  session: "会话恢复 · Level 2",
  fullContext: "完整上下文 · Level 3",
};

/** 恢复层级 → 徽标色调。 */
export const RESTORE_LEVEL_TONE: Record<RestoreLevel, WorkspaceTone> = {
  none: "neutral",
  project: "success",
  session: "warning",
  fullContext: "warning",
};

/** 上次恢复结果 → 中文标签。 */
export const RESTORE_STATUS_LABEL: Record<RestoreStatus, string> = {
  success: "上次恢复成功",
  failed: "上次恢复失败",
};

/** 会话恢复支持情况 → 中文标签。 */
export const SESSION_RESUME_LABEL: Record<SessionResumeSupport, string> = {
  unsupported: "不支持会话恢复",
  documentedUnverified: "有官方机制 · 尚未验证",
};

/** 会话恢复支持情况 → 徽标色调。 */
export const SESSION_RESUME_TONE: Record<SessionResumeSupport, WorkspaceTone> = {
  unsupported: "neutral",
  documentedUnverified: "warning",
};

/** 工作上下文当前可恢复状态（来自真实检查结果，而非静态演示数据）。 */
export type SessionStateId =
  | "ready"
  | "projectMissing"
  | "toolUnavailable"
  | "needsConfiguration"
  | "unsupported"
  | "restoreFailed";

export interface SessionState {
  id: SessionStateId;
  label: string;
  tone: WorkspaceTone;
  /** 是否可以点击「恢复」。 */
  canRestore: boolean;
  /** 面向用户的简短说明。 */
  detail: string;
}

const STATE_META: Record<SessionStateId, Omit<SessionState, "id">> = {
  ready: {
    label: "可恢复",
    tone: "success",
    canRestore: true,
    detail: "项目目录与开发工具均可用。",
  },
  projectMissing: {
    label: "项目目录不存在",
    tone: "danger",
    canRestore: false,
    detail: "项目目录已被移动或删除，请在 Projects 页面重新定位后再恢复。",
  },
  toolUnavailable: {
    label: "工具不可用",
    tone: "warning",
    canRestore: false,
    detail: "所选开发工具未安装或路径失效，请在 Tools 页面重新配置。",
  },
  needsConfiguration: {
    label: "需要补充配置",
    tone: "warning",
    canRestore: false,
    detail: "尚未选定可用的开发工具，请先选择工具再进行恢复。",
  },
  unsupported: {
    label: "当前工具不支持",
    tone: "warning",
    canRestore: false,
    detail: "所选工具不支持受控启动，可改用其他工具恢复该项目。",
  },
  restoreFailed: {
    label: "上次恢复失败",
    tone: "danger",
    canRestore: true,
    detail: "上次恢复未成功，可在修复后重试。",
  },
};

/**
 * 根据记录与当前工具状态推导可恢复状态。
 *
 * 记录自身未指定工具时，回退到项目的默认开发工具（后端恢复逻辑同样如此）；
 * 两者都没有或对应工具条目不存在时按「需要补充配置」处理。
 */
export function getSessionState(
  session: WorkspaceSession,
  toolById: Record<string, ToolEntry>,
  projectDefaultToolId: string | null,
): SessionState {
  let id: SessionStateId;
  if (!session.projectPathExists) {
    id = "projectMissing";
  } else {
    const effectiveToolId = session.toolId ?? projectDefaultToolId;
    const tool = effectiveToolId ? toolById[effectiveToolId] : undefined;
    if (!effectiveToolId || !tool) {
      id = "needsConfiguration";
    } else if (tool.launch.support === "supported") {
      id = session.lastRestoreStatus === "failed" ? "restoreFailed" : "ready";
    } else if (tool.launch.support === "needsConfiguration") {
      id = "needsConfiguration";
    } else if (tool.launch.support === "unsupported") {
      id = "unsupported";
    } else {
      id = "toolUnavailable";
    }
  }
  return { id, ...STATE_META[id] };
}

/** 会话展示名称：用户标签优先，其次项目名。 */
export function sessionName(session: WorkspaceSession): string {
  return session.label ?? session.projectName ?? "未命名工作上下文";
}

/** 视图中选择「恢复前切换工具」时可选的工具（仅具备受控启动能力的工具）。 */
export function restorableTools(tools: ToolEntry[]): ToolEntry[] {
  return tools.filter((tool) => tool.launch.support === "supported");
}
