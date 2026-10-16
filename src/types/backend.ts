/**
 * 后端（Rust）暴露给前端的共享类型定义。
 * 字段命名需与 src-tauri/src 中序列化后的结构保持一致。
 */

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
