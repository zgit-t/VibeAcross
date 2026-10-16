import type { TranslationKey } from "../../i18n";
import type { ProjectPathStatus, ProjectToolHealth } from "../../types/domain";
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
