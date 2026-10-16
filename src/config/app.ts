/** 应用级常量。版本号由 Vite 从 package.json 注入，避免与实际版本不一致。 */

export const APP_NAME = "VibeAcross";
export const APP_VERSION = __APP_VERSION__;
export const APP_TAGLINE = "面向 Vibe Coding 开发者的本地桌面工作区管理工具";
export const APP_DESCRIPTION =
  "VibeAcross 统一管理本地开发项目、AI 编程工具、开发任务与最近活动，所有数据均保存在本机。";

/** 核心运行环境信息，用于关于页面展示。 */
export const APP_STACK = [
  "Tauri 2",
  "React 19",
  "TypeScript",
  "Vite",
  "Rust",
  "SQLite",
] as const;
