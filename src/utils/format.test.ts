import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatRelativeTime,
  lastPathSegment,
} from "./format";

describe("formatRelativeTime", () => {
  it("null 返回「从未」", () => {
    expect(formatRelativeTime(null)).toBe("从未");
  });

  it("非法时间返回「未知」", () => {
    expect(formatRelativeTime("not-a-date")).toBe("未知");
  });

  it("过去时间使用相对表达", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo.toISOString())).toContain("天前");
  });
});

describe("formatDateTime", () => {
  it("null 返回「尚未记录」", () => {
    expect(formatDateTime(null)).toBe("尚未记录");
  });

  it("非法时间返回「未知」", () => {
    expect(formatDateTime("not-a-date")).toBe("未知");
  });

  it("合法时间返回本地化文本", () => {
    expect(formatDateTime("2026-01-02T03:04:05.000Z")).toMatch(/2026/);
  });
});

describe("lastPathSegment", () => {
  it("提取 Windows 路径末段", () => {
    expect(lastPathSegment("C:\\dev\\my-project")).toBe("my-project");
  });

  it("提取 POSIX 路径末段", () => {
    expect(lastPathSegment("/home/user/app/")).toBe("app");
  });

  it("无分隔符时原样返回", () => {
    expect(lastPathSegment("plain")).toBe("plain");
  });
});
