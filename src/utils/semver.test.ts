import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isPrerelease,
  isValidVersion,
  isVersionNewer,
  parseVersion,
} from "./semver";

describe("parseVersion", () => {
  it("解析基本版本", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("解析预发布与构建元数据", () => {
    expect(parseVersion("1.2.3-beta.1+build.5")?.prerelease).toEqual([
      "beta",
      "1",
    ]);
  });

  it("忽略首尾空白", () => {
    expect(isValidVersion("  1.0.0  ")).toBe(true);
  });

  it("拒绝非法格式", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("1.2.3.4")).toBeNull();
    expect(isValidVersion("abc")).toBe(false);
  });
});

describe("isPrerelease", () => {
  it("区分正式版与预发布版", () => {
    expect(isPrerelease("1.0.0")).toBe(false);
    expect(isPrerelease("1.0.0-rc.1")).toBe(true);
    expect(isPrerelease("bad")).toBe(false);
  });
});

describe("compareVersions", () => {
  it("按 major/minor/patch 主序比较", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("正式版高于同号预发布版", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("预发布标识按 SemVer 规则比较", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBeGreaterThan(
      0,
    );
  });

  it("非法版本抛出错误", () => {
    expect(() => compareVersions("nope", "1.0.0")).toThrow();
  });
});

describe("isVersionNewer", () => {
  it("仅在严格更新时为真", () => {
    expect(isVersionNewer("1.2.0", "1.1.0")).toBe(true);
    expect(isVersionNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isVersionNewer("1.0.0", "1.1.0")).toBe(false);
  });

  it("任一版本非法时返回 false", () => {
    expect(isVersionNewer("bad", "1.0.0")).toBe(false);
    expect(isVersionNewer("1.0.0", "bad")).toBe(false);
  });
});
