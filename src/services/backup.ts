/**
 * 本地数据库备份与恢复的封装（由 Rust 后端执行）。
 *
 * 备份使用 SQLite 一致性快照，不包含用户项目目录中的源代码。
 */

import { invoke } from "@tauri-apps/api/core";
import type { BackupInfo, BackupRestoreResult } from "../types/domain";

/** 建议的备份文件名（可识别 + 专用扩展名）。 */
export function suggestedBackupFileName(): Promise<string> {
  return invoke<string>("suggested_backup_file_name");
}

/**
 * 创建一致性备份到 `targetPath`。
 *
 * 目标文件已存在且 `overwrite` 为 false 时后端返回 `BACKUP_TARGET_EXISTS`，
 * 由调用方提示用户确认后再以 `overwrite: true` 重试。
 */
export function createBackup(
  targetPath: string,
  overwrite = false,
): Promise<BackupInfo> {
  return invoke<BackupInfo>("create_backup", { targetPath, overwrite });
}

/** 只读校验一个备份文件，返回其版本与数据规模（不改动任何数据）。 */
export function inspectBackup(path: string): Promise<BackupInfo> {
  return invoke<BackupInfo>("inspect_backup", { path });
}

/** 从所选备份文件受控恢复；恢复前后端会自动创建保护性备份。 */
export function restoreBackup(sourcePath: string): Promise<BackupRestoreResult> {
  return invoke<BackupRestoreResult>("restore_backup", { sourcePath });
}
