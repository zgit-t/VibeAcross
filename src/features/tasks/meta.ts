import { CheckCircle2, CircleDashed, LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey, TranslationVars } from "../../i18n";
import type { TaskPriority, TaskSort, TaskStatus } from "../../types/domain";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/** 与 `useI18n()` 的 `t` 签名一致，便于在纯函数中注入翻译器。 */
export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

export interface TaskStatusMeta {
  labelKey: TranslationKey;
  icon: LucideIcon;
  tone: Tone;
}

/** 状态元数据。颜色之外同时提供图标与文案，避免仅凭颜色传达状态。 */
export const TASK_STATUS_META = {
  todo: { labelKey: "taskStatus.todo", icon: CircleDashed, tone: "neutral" },
  inProgress: {
    labelKey: "taskStatus.inProgress",
    icon: LoaderCircle,
    tone: "accent",
  },
  done: { labelKey: "taskStatus.done", icon: CheckCircle2, tone: "success" },
} satisfies Record<TaskStatus, TaskStatusMeta>;

export const TASK_PRIORITY_META: Record<
  TaskPriority,
  { labelKey: TranslationKey; tone: Tone }
> = {
  low: { labelKey: "taskPriority.low", tone: "neutral" },
  medium: { labelKey: "taskPriority.medium", tone: "warning" },
  high: { labelKey: "taskPriority.high", tone: "danger" },
};

/** 状态的可选项顺序（用于筛选与表单）。 */
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "inProgress", "done"];

const PRIORITY_ORDER: TaskPriority[] = ["low", "medium", "high"];

export function taskStatusLabel(t: Translate, status: TaskStatus): string {
  return t(TASK_STATUS_META[status].labelKey);
}

export function taskPriorityLabel(t: Translate, priority: TaskPriority): string {
  return t(TASK_PRIORITY_META[priority].labelKey);
}

export function taskStatusOptions(
  t: Translate,
): Array<{ value: TaskStatus; label: string }> {
  return TASK_STATUS_ORDER.map((value) => ({
    value,
    label: t(TASK_STATUS_META[value].labelKey),
  }));
}

export function taskPriorityOptions(
  t: Translate,
): Array<{ value: TaskPriority; label: string }> {
  return PRIORITY_ORDER.map((value) => ({
    value,
    label: t(TASK_PRIORITY_META[value].labelKey),
  }));
}

export function taskSortOptions(
  t: Translate,
): Array<{ value: TaskSort; label: string }> {
  return [
    { value: "updated", label: t("taskSort.updated") },
    { value: "created", label: t("taskSort.created") },
  ];
}

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
