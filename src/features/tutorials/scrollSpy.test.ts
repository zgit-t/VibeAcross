import { describe, expect, it } from "vitest";
import { pickTopmostSection, scrollNearestItem } from "./scrollSpy";

const ORDER = ["official", "setup", "integrate", "faq"];

describe("pickTopmostSection", () => {
  it("按文档顺序取最靠上的可见章节", () => {
    expect(pickTopmostSection(["integrate", "setup"], ORDER)).toBe("setup");
    expect(pickTopmostSection(["faq", "official", "integrate"], ORDER)).toBe(
      "official",
    );
  });

  it("单一可见章节时返回该章节", () => {
    expect(pickTopmostSection(["faq"], ORDER)).toBe("faq");
  });

  it("忽略不在目录中的未知锚点", () => {
    expect(pickTopmostSection(["faq/not-detected", "unknown"], ORDER)).toBeNull();
  });

  it("无可见章节时返回 null", () => {
    expect(pickTopmostSection([], ORDER)).toBeNull();
  });

  it("空目录时返回 null（正文未渲染）", () => {
    expect(pickTopmostSection(["official"], [])).toBeNull();
  });
});

function fakeView(top: number, bottom: number) {
  return { getBoundingClientRect: () => ({ top, bottom }), scrollTop: 0 };
}

describe("scrollNearestItem", () => {
  it("条目在可视区下方时向下滚动恰好露出底部", () => {
    const container = fakeView(0, 100);
    scrollNearestItem(container, fakeView(260, 300));
    expect(container.scrollTop).toBe(200);
  });

  it("条目在可视区上方时向上滚动恰好露出顶部", () => {
    const container = fakeView(200, 300);
    scrollNearestItem(container, fakeView(120, 160));
    expect(container.scrollTop).toBe(-80);
  });

  it("条目已完整可见时不滚动", () => {
    const container = fakeView(0, 300);
    scrollNearestItem(container, fakeView(50, 90));
    expect(container.scrollTop).toBe(0);
  });

  it("容器或条目缺失时安全返回", () => {
    const container = fakeView(0, 100);
    expect(() => scrollNearestItem(container, null)).not.toThrow();
    expect(() => scrollNearestItem(null, container)).not.toThrow();
    expect(container.scrollTop).toBe(0);
  });
});
