import type { TranslationKey } from "../../i18n";
import type {
  AiSession,
  HistoryQueryState,
  NativeSessionCapabilities,
} from "../../types/domain";

/** 徽标色调，与 `components/ui/Badge` 保持一致。 */
export type AiTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 历史查询状态 → 翻译键。 */
export const HISTORY_STATE_KEY: Record<HistoryQueryState, TranslationKey> = {
  available: "aiSession.historyStateAvailable",
  sourceMissing: "aiSession.historyStateSourceMissing",
  unreadable: "aiSession.historyStateUnreadable",
  structureUnsupported: "aiSession.historyStateStructureUnsupported",
};

/** 历史查询状态 → 说明文案翻译键。 */
export const HISTORY_STATE_DESC_KEY: Record<HistoryQueryState, TranslationKey> = {
  available: "aiSession.historyStateAvailableDesc",
  sourceMissing: "aiSession.historyStateSourceMissingDesc",
  unreadable: "aiSession.historyStateUnreadableDesc",
  structureUnsupported: "aiSession.historyStateStructureUnsupportedDesc",
};

/** 历史查询状态 → 提示色调（用于 `Notice`）。空来源是正常状态，用 info 而非错误色。 */
export const HISTORY_STATE_TONE: Record<
  HistoryQueryState,
  "info" | "warning" | "danger" | "success"
> = {
  available: "success",
  sourceMissing: "info",
  unreadable: "danger",
  structureUnsupported: "warning",
};

/** 会话当前可恢复状态（来自真实能力与记录，而非静态演示数据）。 */
export type AiSessionStateId =
  | "ready"
  | "projectMissing"
  | "missing"
  | "localOnly"
  | "unsupported";

export interface AiSessionState {
  id: AiSessionStateId;
  labelKey: TranslationKey;
  tone: AiTone;
  /** 是否可以点击「继续会话」。 */
  canRestore: boolean;
}

const STATE_META: Record<AiSessionStateId, Omit<AiSessionState, "id">> = {
  ready: {
    labelKey: "aiSession.statusActive",
    tone: "success",
    canRestore: true,
  },
  projectMissing: {
    labelKey: "aiSession.statusProjectMissing",
    tone: "danger",
    canRestore: false,
  },
  missing: {
    labelKey: "aiSession.statusMissing",
    tone: "danger",
    canRestore: false,
  },
  localOnly: {
    labelKey: "aiSession.statusLocalOnly",
    tone: "neutral",
    canRestore: false,
  },
  unsupported: {
    labelKey: "aiSession.statusUnsupported",
    tone: "warning",
    canRestore: false,
  },
};

/**
 * 根据会话记录、工具能力与项目目录状态推导可恢复状态。
 *
 * 优先级：项目目录不可用 → 原生会话缺失（后端确认）→ 无原生标识（仅本地记录）
 * → 工具不支持恢复 → 可恢复。
 * `markedMissing` 用于标记「尝试恢复时后端报告原生会话已不存在」的记录。
 */
export function getAiSessionState(
  session: AiSession,
  capabilities: NativeSessionCapabilities | null,
  options: { projectPathExists: boolean; markedMissing?: boolean },
): AiSessionState {
  let id: AiSessionStateId;
  if (!options.projectPathExists) {
    id = "projectMissing";
  } else if (options.markedMissing) {
    id = "missing";
  } else if (!session.nativeSessionId) {
    id = "localOnly";
  } else if (!capabilities || capabilities.restore !== "supported") {
    id = "unsupported";
  } else {
    id = "ready";
  }
  return { id, ...STATE_META[id] };
}

/** 会话展示名称：后端保证 `displayName` 非空，此处仅做兜底。 */
export function aiSessionName(session: AiSession): string {
  return session.displayName.trim() || session.nativeSessionId || session.id;
}
