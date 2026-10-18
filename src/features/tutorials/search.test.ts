import { describe, expect, it } from "vitest";
import { searchTutorials } from "./search";
import { TUTORIALS, getTutorial } from "./tutorials";
import { sectionBodyText } from "./types";

describe("searchTutorials", () => {
  it("空关键词或纯空白返回空数组", () => {
    expect(searchTutorials("", "zh-CN")).toEqual([]);
    expect(searchTutorials("   ", "en-US")).toEqual([]);
  });

  it("关键词大小写不敏感", () => {
    const lower = searchTutorials("cursor", "en-US");
    const upper = searchTutorials("CURSOR", "en-US");
    expect(lower.length).toBeGreaterThan(0);
    expect(upper).toEqual(lower);
  });

  it("按工具名称命中，并指向该工具的第一个章节", () => {
    const results = searchTutorials("Cursor", "en-US");
    const toolHit = results.find(
      (result) => result.toolId === "cursor" && result.field === "tool",
    );
    expect(toolHit).toBeDefined();
    expect(toolHit?.anchor).toBe("official");
    expect(toolHit?.sectionId).toBe("official");
    expect(toolHit?.sectionTitle.length).toBeGreaterThan(0);
  });

  it("按章节标题命中（中英文）", () => {
    const zh = searchTutorials("初始配置", "zh-CN");
    expect(zh.length).toBeGreaterThan(0);
    expect(
      zh.every((result) => result.sectionId === "setup"),
    ).toBe(true);
    expect(zh[0]?.field).toBe("title");

    const en = searchTutorials("Initial setup", "en-US");
    expect(en.length).toBeGreaterThan(0);
    expect(en.every((result) => result.sectionId === "setup")).toBe(true);
  });

  it("按正文命中并落到实际包含该文本的章节", () => {
    const results = searchTutorials("winget", "en-US");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.toolId === "claude-code")).toBe(
      true,
    );
    expect(results.every((result) => result.field === "body")).toBe(true);

    const tutorial = getTutorial("claude-code");
    const expectedSection = tutorial?.sections.find((section) =>
      sectionBodyText(section, "en-US").toLowerCase().includes("winget"),
    );
    expect(expectedSection).toBeDefined();
    expect(
      results.every((result) => result.anchor === expectedSection?.id),
    ).toBe(true);
  });

  it("按常见问题命中，锚点指向具体问答条目", () => {
    const results = searchTutorials("路径无效", "zh-CN");
    const faqHits = results.filter((result) => result.field === "faq");
    expect(faqHits.length).toBeGreaterThan(0);
    expect(faqHits.every((result) => result.anchor.includes("/"))).toBe(true);
    expect(faqHits.every((result) => result.anchor.startsWith("faq/"))).toBe(
      true,
    );
  });

  it("重复章节标题的命中仍归属各自的工具", () => {
    const results = searchTutorials("常见问题", "zh-CN");
    const toolIds = results.map((result) => result.toolId);
    // 每个工具至多一条，避免同一章节重复出现。
    expect(new Set(toolIds).size).toBe(toolIds.length);
    expect(results.every((result) => result.anchor === "faq")).toBe(true);
    expect(toolIds.length).toBeGreaterThan(1);
  });

  it("同一教程内结果锚点唯一", () => {
    for (const tutorial of TUTORIALS) {
      const anchors = searchTutorials(tutorial.toolName, "en-US")
        .filter((result) => result.toolId === tutorial.toolId)
        .map((result) => result.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });

  it("无匹配时返回空数组", () => {
    expect(searchTutorials("zzzz-no-such-term-zzzz", "en-US")).toEqual([]);
  });

  it("每条结果都带有工具名、章节标题与非空摘要", () => {
    const results = searchTutorials("install", "en-US");
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.toolName.length).toBeGreaterThan(0);
      expect(result.sectionTitle.length).toBeGreaterThan(0);
      expect(result.snippet.length).toBeGreaterThan(0);
    }
  });
});
