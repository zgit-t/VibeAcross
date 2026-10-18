import {
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  RotateCcw,
  Settings,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "../i18n";
import type { ViewId } from "../types/navigation";

export interface NavItem {
  id: ViewId;
  /** 导航标签的翻译键。 */
  labelKey: TranslationKey;
  icon: LucideIcon;
}

/** 主侧边栏导航。 */
export const PRIMARY_NAV: NavItem[] = [
  { id: "overview", labelKey: "nav.overview", icon: LayoutDashboard },
  { id: "projects", labelKey: "nav.projects", icon: FolderKanban },
  { id: "tools", labelKey: "nav.tools", icon: Wrench },
  { id: "tutorials", labelKey: "nav.tutorials", icon: GraduationCap },
  { id: "tasks", labelKey: "nav.tasks", icon: ListChecks },
  { id: "sessions", labelKey: "nav.sessions", icon: RotateCcw },
];

/** 侧边栏底部导航，与主导航区分。 */
export const SECONDARY_NAV: NavItem[] = [
  { id: "settings", labelKey: "nav.settings", icon: Settings },
];
