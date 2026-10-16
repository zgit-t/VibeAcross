import { Cpu, FolderKanban, ListChecks, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActivityType } from "../../types/domain";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

interface ActivityMeta {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

export const ACTIVITY_META: Record<ActivityType, ActivityMeta> = {
  Project: { label: "项目", icon: FolderKanban, tone: "accent" },
  Tool: { label: "工具", icon: Wrench, tone: "neutral" },
  Task: { label: "任务", icon: ListChecks, tone: "warning" },
  System: { label: "系统", icon: Cpu, tone: "neutral" },
};

export const ACTIVITY_TYPES: ActivityType[] = [
  "Project",
  "Tool",
  "Task",
  "System",
];
