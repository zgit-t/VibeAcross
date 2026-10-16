/**
 * 应用设置的持久化封装（由 Rust 后端写入 SQLite）。
 */

import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, StorageInfo } from "../types/domain";

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

/** 写入完整设置对象；传空值表示清除该项。 */
export function updateSettings(
  settingsInput: AppSettings,
): Promise<AppSettings> {
  return invoke<AppSettings>("update_settings", { settingsInput });
}

/** 获取数据库文件与应用数据目录位置。 */
export function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>("get_storage_info");
}
