import type { Project } from "../../types/domain";

/**
 * 按关键字与「仅收藏」过滤项目列表。
 *
 * 关键字匹配项目名称或路径（忽略大小写）；`favoritesOnly` 为真时仅保留收藏项。
 * 该逻辑抽为纯函数以便单独测试（页面内的组合筛选）。
 */
export function filterProjects(
  projects: Project[],
  query: string,
  favoritesOnly: boolean,
): Project[] {
  const keyword = query.trim().toLowerCase();
  return projects.filter((project) => {
    const matchesQuery =
      !keyword ||
      project.name.toLowerCase().includes(keyword) ||
      project.path.toLowerCase().includes(keyword);
    const matchesFavorite = !favoritesOnly || project.isFavorite;
    return matchesQuery && matchesFavorite;
  });
}
