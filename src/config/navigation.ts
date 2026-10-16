import {
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  RotateCcw,
  Settings,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ViewId } from "../types/navigation";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

/** 主侧边栏导航。 */
export const PRIMARY_NAV: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "sessions", label: "Sessions", icon: RotateCcw },
  { id: "activity", label: "Activity", icon: History },
];

/** 侧边栏底部导航，与主导航区分。 */
export const SECONDARY_NAV: NavItem[] = [
  { id: "settings", label: "Settings", icon: Settings },
];
