import type {
  LaunchMethod,
  LaunchSupport,
  ToolStatus,
  ToolType,
} from "../../types/domain";

/** 徽标色调，与 `components/ui/Badge` 保持一致。 */
export type ToolBadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 工具状态 → 中文标签。 */
export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  detected: "已检测到",
  notDetected: "尚未检测",
  notInstalled: "未安装",
  pathMissing: "路径失效",
  unverified: "无法验证",
  detectionFailed: "检测失败",
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

/** 工具类型 → 中文标签。 */
export const TOOL_TYPE_LABEL: Record<ToolType, string> = {
  desktop: "桌面应用",
  cli: "命令行工具",
};

/** 启动能力 → 中文标签。 */
export const LAUNCH_SUPPORT_LABEL: Record<LaunchSupport, string> = {
  supported: "可启动",
  needsConfiguration: "需补充配置",
  unsupported: "暂不支持启动",
  unavailable: "不可用",
};

/** 启动能力 → 徽标色调。 */
export const LAUNCH_SUPPORT_TONE: Record<LaunchSupport, ToolBadgeTone> = {
  supported: "success",
  needsConfiguration: "warning",
  unsupported: "warning",
  unavailable: "neutral",
};

/** 启动方式 → 中文说明。 */
export const LAUNCH_METHOD_LABEL: Record<LaunchMethod, string> = {
  folderArgument: "以项目目录作为参数打开",
  workingDirectory: "在项目目录中打开命令行",
};

/** 检测状态筛选选项。 */
export const STATUS_FILTERS: Array<{ value: ToolStatus | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "detected", label: "已检测到" },
  { value: "notInstalled", label: "未安装" },
  { value: "notDetected", label: "尚未检测" },
  { value: "pathMissing", label: "路径失效" },
  { value: "unverified", label: "无法验证" },
  { value: "detectionFailed", label: "检测失败" },
];

export function getStatusLabel(status: ToolStatus): string {
  return TOOL_STATUS_LABEL[status] ?? status;
}

export function getStatusTone(status: ToolStatus): ToolBadgeTone {
  return TOOL_STATUS_TONE[status] ?? "neutral";
}
