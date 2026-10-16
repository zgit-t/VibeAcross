/**
 * 全局搜索的封装（由 Rust 后端执行只读查询）。
 *
 * 检索范围：项目名称 / 备注、任务标题 / 描述、工作上下文中的名称 / 项目名 /
 * 工具名 / 任务标题。不扫描项目源代码，不递归读取用户文件。
 */
import { invoke } from "@tauri-apps/api/core";
import type { SearchResults } from "../types/domain";

/** 每类结果的默认上限（与后端一致）。 */
export const DEFAULT_SEARCH_LIMIT = 10;

/**
 * 执行全局搜索。空查询返回空结果（后端不会产生数据库查询）。
 */
export function globalSearch(
  query: string,
  limit?: number,
): Promise<SearchResults> {
  return invoke<SearchResults>("global_search", {
    query,
    limit: limit ?? null,
  });
}
