/** 应用级常量。版本号由 Vite 从 package.json 注入，避免与实际版本不一致。 */

export const APP_NAME = "VibeAcross";
export const APP_VERSION = __APP_VERSION__;

/** 核心运行环境信息，用于关于页面展示。 */
export const APP_STACK = [
  "Tauri 2",
  "React 19",
  "TypeScript",
  "Vite",
  "Rust",
  "SQLite",
] as const;
