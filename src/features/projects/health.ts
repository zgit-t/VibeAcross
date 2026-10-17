import type { TranslationKey } from "../../i18n";
import type {
  ProjectPathStatus,
  ProjectToolHealth,
  ToolEntry,
} from "../../types/domain";
import type { ToolBadgeTone } from "../tools/data";

/** 项目路径健康状态 → 翻译键。 */
export const PATH_STATUS_KEY: Record<ProjectPathStatus, TranslationKey> = {
  ok: "health.pathOk",
  missing: "health.pathMissing",
  notDirectory: "health.pathNotDirectory",
  inaccessible: "health.pathInaccessible",
  unknown: "health.pathUnknown",
};

/** 项目路径健康状态 → 徽标色调。 */
export const PATH_STATUS_TONE: Record<ProjectPathStatus, ToolBadgeTone> = {
  ok: "success",
  missing: "warning",
  notDirectory: "warning",
  inaccessible: "warning",
  unknown: "neutral",
};

/** 默认工具启动能力 → 翻译键。 */
export const TOOL_HEALTH_KEY: Record<ProjectToolHealth, TranslationKey> = {
  notConfigured: "health.toolNotConfigured",
  missing: "health.toolMissing",
  unavailable: "health.toolUnavailable",
  notLaunchable: "health.toolNotLaunchable",
  ready: "health.toolReady",
};

/** 默认工具启动能力 → 徽标色调。 */
export const TOOL_HEALTH_TONE: Record<ProjectToolHealth, ToolBadgeTone> = {
  notConfigured: "neutral",
  missing: "warning",
  unavailable: "warning",
  notLaunchable: "warning",
  ready: "success",
};

/** 项目路径是否有效。 */
export function isPathHealthy(status: ProjectPathStatus): boolean {
  return status === "ok";
}

/** 默认工具是否需要用户处理（缺失 / 不可用 / 不受支持）。 */
export function needsToolAttention(status: ProjectToolHealth): boolean {
  return (
    status === "missing" ||
    status === "unavailable" ||
    status === "notLaunchable"
  );
}

/** 默认工具当前是否可直接受控启动。 */
export function isToolReady(status: ProjectToolHealth): boolean {
  return status === "ready";
}

/** 工具当前是否已识别（已检测到）且可受控启动。 */
export function toolIsLaunchable(tool: ToolEntry): boolean {
  return tool.installed && tool.launch.support === "supported";
}

/**
 * 项目「当前工具」的解析状态。刻意把「未设置」与各种异常区分开：
 *  - `unset`：项目尚未选择开发工具；
 *  - `ready`：已设置、已检测到且可受控启动；
 *  - `notDetected`：已设置，但当前未检测到该工具（未安装 / 尚未检测成功）；
 *  - `notLaunchable`：已检测到，但当前无法受控启动（需补充配置 / 不受支持）；
 *  - `removed`：已设置，但对应的工具配置已被移除。
 */
export type DefaultToolState =
  | "unset"
  | "ready"
  | "notDetected"
  | "notLaunchable"
  | "removed";

/** 解析项目当前工具的真实状态（不修改、不回退到其它工具）。 */
export function resolveDefaultTool(
  defaultToolId: string | null,
  tools: ToolEntry[],
): { state: DefaultToolState; tool: ToolEntry | null } {
  if (!defaultToolId) {
    return { state: "unset", tool: null };
  }
  const tool = tools.find((entry) => entry.id === defaultToolId) ?? null;
  if (!tool) {
    return { state: "removed", tool: null };
  }
  if (!tool.installed) {
    return { state: "notDetected", tool };
  }
  if (tool.launch.support !== "supported") {
    return { state: "notLaunchable", tool };
  }
  return { state: "ready", tool };
}

/** 当前工具的异常状态 → 下拉项内的短标签。 */
export const DEFAULT_TOOL_ISSUE_KEY: Record<
  Exclude<DefaultToolState, "unset" | "ready">,
  TranslationKey
> = {
  notDetected: "projectList.defaultNotDetected",
  notLaunchable: "projectList.defaultNotLaunchable",
  removed: "projectList.defaultRemoved",
};

/** 当前工具的异常状态 → 启动按钮的可用性提示。 */
export const DEFAULT_TOOL_LAUNCH_HINT_KEY: Record<
  Exclude<DefaultToolState, "unset" | "ready">,
  TranslationKey
> = {
  notDetected: "projectList.launchNotDetected",
  notLaunchable: "projectList.launchNotLaunchable",
  removed: "projectList.launchToolRemoved",
};
