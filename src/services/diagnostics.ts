/**
 * 诊断日志的查询与导出封装（由 Rust 后端执行）。
 *
 * 日志记录 OpenCode 原生会话适配器的关键交互，便于复现创建失败时交给开发者分析；
 * 不包含任何对话内容，也未上传到任何服务器。
 */

import { invoke } from "@tauri-apps/api/core";
import type { DiagnosticsContent, DiagnosticsInfo } from "../types/domain";

/** 读取诊断日志文件的位置与大小（不创建文件）。 */
export function getDiagnosticsInfo(): Promise<DiagnosticsInfo> {
  return invoke<DiagnosticsInfo>("get_diagnostics_info");
}

/** 读取诊断日志正文，供应用内查看（最多返回末尾 256 KB）。 */
export function getDiagnosticsContent(): Promise<DiagnosticsContent> {
  return invoke<DiagnosticsContent>("get_diagnostics_content");
}

/** 清空诊断日志（幂等）；返回清空后的状态。 */
export function clearDiagnostics(): Promise<DiagnosticsInfo> {
  return invoke<DiagnosticsInfo>("clear_diagnostics");
}

/** 在系统文件管理器中定位诊断日志文件。 */
export function openDiagnosticsLocation(): Promise<void> {
  return invoke<void>("open_diagnostics_location");
}

/** 建议的导出文件名（可识别 + `.log` 扩展名）。 */
export function suggestedDiagnosticsFileName(): Promise<string> {
  return invoke<string>("suggested_diagnostics_file_name");
}

/**
 * 把诊断日志导出到 `targetPath`。
 *
 * 目标文件已存在且 `overwrite` 为 false 时后端返回 `DIAGNOSTICS_TARGET_EXISTS`，
 * 由调用方提示用户确认后再以 `overwrite: true` 重试。
 */
export function exportDiagnostics(
  targetPath: string,
  overwrite = false,
): Promise<DiagnosticsInfo> {
  return invoke<DiagnosticsInfo>("export_diagnostics", { targetPath, overwrite });
}
