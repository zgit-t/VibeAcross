import type { TranslationKey } from "../../i18n";
import type {
  LaunchMethod,
  LaunchSupport,
  ToolEntry,
  ToolStatus,
  ToolType,
} from "../../types/domain";

/** 徽标色调，与 `components/ui/Badge` 保持一致。 */
export type ToolBadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 工具状态 → 翻译键。 */
export const TOOL_STATUS_KEY: Record<ToolStatus, TranslationKey> = {
  detected: "toolStatus.detected",
  notDetected: "toolStatus.notDetected",
  notInstalled: "toolStatus.notInstalled",
  pathMissing: "toolStatus.pathMissing",
  unverified: "toolStatus.unverified",
  detectionFailed: "toolStatus.detectionFailed",
};

/** 工具状态 → 徽标色调。 */
export const TOOL_STATUS_TONE: Record<ToolStatus, ToolBadgeTone> = {
  detected: "success",
  notDetected: "neutral",
  notInstalled: "neutral",
  pathMissing: "warning",
  unverified: "warning",
  detectionFailed: "danger",
};

/** 工具类型 → 翻译键。 */
export const TOOL_TYPE_KEY: Record<ToolType, TranslationKey> = {
  desktop: "toolType.desktop",
  cli: "toolType.cli",
};

/** 启动能力 → 翻译键。 */
export const LAUNCH_SUPPORT_KEY: Record<LaunchSupport, TranslationKey> = {
  supported: "launchSupport.supported",
  needsConfiguration: "launchSupport.needsConfiguration",
  unsupported: "launchSupport.unsupported",
  unavailable: "launchSupport.unavailable",
};

/** 启动能力 → 徽标色调。 */
export const LAUNCH_SUPPORT_TONE: Record<LaunchSupport, ToolBadgeTone> = {
  supported: "success",
  needsConfiguration: "warning",
  unsupported: "warning",
  unavailable: "neutral",
};

/** 启动方式 → 翻译键。 */
export const LAUNCH_METHOD_KEY: Record<LaunchMethod, TranslationKey> = {
  folderArgument: "launchMethod.folderArgument",
  workingDirectory: "launchMethod.workingDirectory",
};

/** 检测状态筛选项的可选值顺序。 */
export const STATUS_FILTER_VALUES: Array<ToolStatus | "all"> = [
  "all",
  "detected",
  "notInstalled",
  "notDetected",
  "pathMissing",
  "unverified",
  "detectionFailed",
];

export function getStatusTone(status: ToolStatus): ToolBadgeTone {
  return TOOL_STATUS_TONE[status] ?? "neutral";
}

/** 工具行内可执行的操作。 */
export type ToolRowAction =
  | "tutorial"
  | "manualConfig"
  | "detect"
  | "redetect"
  | "revalidate"
  | "setDefault"
  | "unsetDefault"
  | "configure"
  | "remove";

/**
 * 根据工具的**来源**（`source`）与**当前状态**（`status`）推导行内可用操作，
 * 只展示此刻真正有意义的操作，避免误导性的重复按钮：
 *
 * - 任何来源都提供 `教程`（有专属教程则打开，否则展示无教程状态）。
 * - 内置占位（`builtin`，尚未配置）：`手动配置` + `检测`。
 * - 自动检测发现（`auto`）：`重新检测`（重新扫描本机安装）。
 * - 手动添加且路径有效（`manual` + `detected`）：**不提供重复检测**，
 *   路径在添加 / 编辑时已校验，仅保留 `配置` / `移除`。
 * - 手动添加但路径无效（`manual` + `pathMissing` / `unverified` /
 *   `detectionFailed`）：提供 `重新验证`（针对已保存路径，不触发全量自动检测，
 *   因此不会产生重复条目）。
 * - 已检测到的工具额外提供默认工具切换。
 */
export function getToolRowActions(
  tool: Pick<ToolEntry, "source" | "status" | "installed" | "isDefault">,
): ToolRowAction[] {
  if (tool.source === "builtin") {
    return ["tutorial", "manualConfig", "detect"];
  }

  const actions: ToolRowAction[] = ["tutorial"];
  if (tool.installed) {
    actions.push(tool.isDefault ? "unsetDefault" : "setDefault");
  }
  actions.push("configure");

  if (tool.source === "auto") {
    actions.push("redetect");
  } else if (tool.source === "manual" && tool.status !== "detected") {
    actions.push("revalidate");
  }

  actions.push("remove");
  return actions;
}
