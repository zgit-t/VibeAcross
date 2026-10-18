/** 应用内页面（视图）标识。 */
export type ViewId =
  | "overview"
  | "projects"
  | "tools"
  | "tutorials"
  | "tasks"
  | "sessions"
  | "settings";

/** 主题模式：跟随系统或显式指定。 */
export type ThemeMode = "light" | "dark" | "system";

/** 实际生效的主题（system 解析后的结果）。 */
export type ResolvedTheme = "light" | "dark";
