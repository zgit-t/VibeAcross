import { CheckCircle2, CircleDashed, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TaskPriority, TaskSort, TaskStatus } from "../../types/domain";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface TaskStatusMeta {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

/** 状态元数据。颜色之外同时提供图标与文案，避免仅凭颜色传达状态。 */
export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  todo: { label: "待办", icon: CircleDashed, tone: "neutral" },
  inProgress: { label: "进行中", icon: LoaderCircle, tone: "accent" },
  done: { label: "已完成", icon: CheckCircle2, tone: "success" },
};

export const TASK_PRIORITY_META: Record<
  TaskPriority,
  { label: string; tone: Tone }
> = {
  low: { label: "低", tone: "neutral" },
  medium: { label: "中", tone: "warning" },
  high: { label: "高", tone: "danger" },
};

/** 状态的可选项顺序（用于筛选与表单）。 */
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "inProgress", "done"];

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> =
  TASK_STATUS_ORDER.map((value) => ({
    value,
    label: TASK_STATUS_META[value].label,
  }));

export const TASK_PRIORITY_OPTIONS: Array<{
  value: TaskPriority;
  label: string;
}> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

export const TASK_SORT_OPTIONS: Array<{ value: TaskSort; label: string }> = [
  { value: "updated", label: "最近更新" },
  { value: "created", label: "创建时间" },
];

/**
 * 截止日期的展示状态。
 *
 * - `overdue`：已过期且未完成
 * - `today`：今天到期
 * - `upcoming`：将来到期
 * - `none`：未设置或格式无效
 */
export type DueState = "overdue" | "today" | "upcoming" | "none";

export function getDueState(
  dueDate: string | null,
  status: TaskStatus,
): DueState {
  if (!dueDate) {
    return "none";
  }
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return "none";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (status === "done") {
    return "upcoming";
  }
  if (due.getTime() < today.getTime()) {
    return "overdue";
  }
  if (due.getTime() === today.getTime()) {
    return "today";
  }
  return "upcoming";
}
