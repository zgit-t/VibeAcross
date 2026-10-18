/**
 * 教程中心滚动监听辅助函数。
 *
 * 与 DOM 解耦、纯函数可测：`pickTopmostSection` 决定「当前章节」高亮的归属，
 * 便于在不依赖真实滚动的前提下验证高亮逻辑。
 */

/**
 * 从「当前进入可视带」的章节 id 中，按文档顺序选出最靠上的一节。
 *
 * - 只看出现在 `order` 中的 id，忽略未知锚点。
 * - 无匹配时返回 null（例如正文尚未渲染或全部滚出可视带）。
 */
export function pickTopmostSection(
  visibleIds: Iterable<string>,
  order: readonly string[],
): string | null {
  let best: string | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const id of visibleIds) {
    const index = order.indexOf(id);
    if (index === -1 || index >= bestIndex) {
      continue;
    }
    bestIndex = index;
    best = id;
  }
  return best;
}

/**
 * 定位最近的纵向滚动容器（`overflow-y` 为 auto/scroll/overlay 的祖先）。
 *
 * 仅用于为滚动监听选择正确的 `root`；不修改任何布局。浏览器环境不可用时
 * 返回 null，此时监听退化为以视口为 root。
 */
export function findScrollContainer(
  start: HTMLElement | null,
): HTMLElement | null {
  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return null;
  }
  let node = start?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY && /(auto|scroll|overlay)/.test(overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** 可参与「滚动到可见」计算的最小结构（浏览器元素天然满足）。 */
export interface ScrollableView {
  getBoundingClientRect(): { top: number; bottom: number };
  scrollTop: number;
}

/**
 * 让某个条目在**它自己的滚动容器内部**露出来：
 *
 * - 已完整可见时不做任何事（避免抖动与无谓滚动）。
 * - 只修改 `container.scrollTop`，绝不调用 `scrollIntoView`，
 *   因此不会连带滚动页面或其它容器。
 */
export function scrollNearestItem(
  container: ScrollableView | null | undefined,
  item: ScrollableView | null | undefined,
): void {
  if (!container || !item) {
    return;
  }
  const view = container.getBoundingClientRect();
  const target = item.getBoundingClientRect();
  let delta = 0;
  if (target.top < view.top) {
    delta = target.top - view.top;
  } else if (target.bottom > view.bottom) {
    delta = target.bottom - view.bottom;
  }
  if (delta !== 0) {
    container.scrollTop += delta;
  }
}

