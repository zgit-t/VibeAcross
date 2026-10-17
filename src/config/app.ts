/** 应用级常量。版本号由 Vite 从 package.json 注入，避免与实际版本不一致。 */

export const APP_NAME = "VibeAcross";
export const APP_VERSION = __APP_VERSION__;

/** 公开源码仓库地址（与 README 中配置保持一致），用于关于页面的源码入口。 */
export const APP_REPOSITORY_URL = "https://github.com/zgit-t/VibeAcross";

/** 核心运行环境信息，用于关于页面展示。 */
export const APP_STACK = [
  "Tauri 2",
  "React 19",
  "TypeScript",
  "Vite",
  "Rust",
  "SQLite",
] as const;
