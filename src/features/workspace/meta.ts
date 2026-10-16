import type { TranslationKey } from "../../i18n";
import { t } from "../../i18n/translate";
import type {
  RestoreLevel,
  RestoreStatus,
  SessionResumeSupport,
  ToolEntry,
  WorkspaceSession,
} from "../../types/domain";

/** 徽标色调，与 `components/ui/Badge` 保持一致。 */
export type WorkspaceTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 恢复层级 → 翻译键。 */
export const RESTORE_LEVEL_KEY: Record<RestoreLevel, TranslationKey> = {
  none: "restoreLevel.none",
  project: "restoreLevel.project",
  session: "restoreLevel.session",
  fullContext: "restoreLevel.fullContext",
};

/** 恢复层级 → 徽标色调。 */
export const RESTORE_LEVEL_TONE: Record<RestoreLevel, WorkspaceTone> = {
  none: "neutral",
  project: "success",
  session: "warning",
  fullContext: "warning",
};

/** 上次恢复结果 → 翻译键。 */
export const RESTORE_STATUS_KEY: Record<RestoreStatus, TranslationKey> = {
  success: "restoreStatus.success",
  failed: "restoreStatus.failed",
};

/** 会话恢复支持情况 → 翻译键。 */
export const SESSION_RESUME_KEY: Record<SessionResumeSupport, TranslationKey> = {
  unsupported: "sessionResume.unsupported",
  documentedUnverified: "sessionResume.documentedUnverified",
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
  labelKey: TranslationKey;
  tone: WorkspaceTone;
  /** 是否可以点击「恢复」。 */
  canRestore: boolean;
  /** 面向用户的简短说明的翻译键。 */
  detailKey: TranslationKey;
}

const STATE_META: Record<SessionStateId, Omit<SessionState, "id">> = {
  ready: {
    labelKey: "sessionState.ready.label",
    tone: "success",
    canRestore: true,
    detailKey: "sessionState.ready.detail",
  },
  projectMissing: {
    labelKey: "sessionState.projectMissing.label",
    tone: "danger",
    canRestore: false,
    detailKey: "sessionState.projectMissing.detail",
  },
  toolUnavailable: {
    labelKey: "sessionState.toolUnavailable.label",
    tone: "warning",
    canRestore: false,
    detailKey: "sessionState.toolUnavailable.detail",
  },
  needsConfiguration: {
    labelKey: "sessionState.needsConfiguration.label",
    tone: "warning",
    canRestore: false,
    detailKey: "sessionState.needsConfiguration.detail",
  },
  unsupported: {
    labelKey: "sessionState.unsupported.label",
    tone: "warning",
    canRestore: false,
    detailKey: "sessionState.unsupported.detail",
  },
  restoreFailed: {
    labelKey: "sessionState.restoreFailed.label",
    tone: "danger",
    canRestore: true,
    detailKey: "sessionState.restoreFailed.detail",
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
  return session.label ?? session.projectName ?? t("session.unnamed");
}

/** 视图中选择「恢复前切换工具」时可选的工具（仅具备受控启动能力的工具）。 */
export function restorableTools(tools: ToolEntry[]): ToolEntry[] {
  return tools.filter((tool) => tool.launch.support === "supported");
}
