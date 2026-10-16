/**
 * 系统原生目录选择对话框。
 *
 * 仅在 Tauri 桌面运行时可用；纯浏览器开发模式返回 null，由调用方给出提示。
 */

import { isDesktopRuntime } from "./backend";

interface PickDirectoryOptions {
  /** 对话框打开时的初始目录。 */
  defaultPath?: string | null;
  title?: string;
}

/** 打开目录选择器，返回所选绝对路径；取消或不可用时返回 null。 */
export async function pickDirectory(
  options: PickDirectoryOptions = {},
): Promise<string | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: options.title ?? "选择文件夹",
    defaultPath: options.defaultPath ?? undefined,
  });

  return typeof selected === "string" ? selected : null;
}

interface PickFileOptions {
  /** 对话框打开时的初始目录。 */
  defaultPath?: string | null;
  title?: string;
  /** 允许扩展名（不含点），例如 ["exe", "cmd"]。 */
  extensions?: string[];
}

/** 打开文件选择器，返回所选文件绝对路径；取消或不可用时返回 null。 */
export async function pickFile(
  options: PickFileOptions = {},
): Promise<string | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: false,
    multiple: false,
    title: options.title ?? "选择可执行文件",
    defaultPath: options.defaultPath ?? undefined,
    filters: options.extensions
      ? [{ name: "可执行文件", extensions: options.extensions }]
      : undefined,
  });

  return typeof selected === "string" ? selected : null;
}
