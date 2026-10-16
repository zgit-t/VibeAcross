import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n/translate";
import type { AppInfo } from "../types/backend";

/**
 * 判断当前是否运行在 Tauri 宿主环境中。
 * 使用纯浏览器运行（npm run dev）时返回 false，便于开发时优雅降级。
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 调用 Rust 后端的 greet 命令，返回问候语。
 * 这是前端与桌面后端通信的最小示例。
 */
export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

/** 获取由 Rust 后端提供的应用基础信息。 */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

/** 后端命令返回的结构化错误。 */
export interface BackendError {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 判断任意值是否为后端返回的结构化错误。 */
export function isBackendError(value: unknown): value is BackendError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

/** 将任意错误转换为可展示的提示文案（回退到当前语言）。 */
export function toErrorMessage(
  error: unknown,
  fallback: string = t("error.genericDefault"),
): string {
  if (isBackendError(error)) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

/** 非桌面运行时的统一提示文案（按当前语言解析）。 */
export function notDesktopMessage(): string {
  return t("error.notDesktop");
}
