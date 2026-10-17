import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assetDownloadUrl,
  buildLatestManifest,
  readSignatureFile,
  SUPPORTED_PLATFORM,
  validateLatestManifest,
} from "./generate-update-manifest.mjs";

const SIGNATURE = [
  "untrusted comment: signature from tauri secret key",
  "RWQ8/6vB1lJm9Fc2h4pQ0sT7yU3xW5zA6bC4dE2fG0hI1jK3lM5nO7pQ9rS1tU3vW5xY7zA==",
].join("\n");

function baseManifest() {
  return {
    version: "1.2.0",
    notes: "修复更新检查。",
    pub_date: "2026-10-18T00:00:00.000Z",
    platforms: {
      [SUPPORTED_PLATFORM]: {
        signature: SIGNATURE,
        url: "https://github.com/zgit-t/VibeAcross/releases/download/v1.2.0/VibeAcross_1.2.0_x64-setup.exe",
      },
    },
  };
}

describe("assetDownloadUrl", () => {
  it("拼接 GitHub Release 资产地址", () => {
    expect(assetDownloadUrl("zgit-t/VibeAcross", "v1.2.0", "VibeAcross_1.2.0_x64-setup.exe")).toBe(
      "https://github.com/zgit-t/VibeAcross/releases/download/v1.2.0/VibeAcross_1.2.0_x64-setup.exe",
    );
  });

  it("仓库名非法时报错", () => {
    expect(() => assetDownloadUrl("not-a-repo", "v1.2.0", "a.zip")).toThrow();
  });
});

describe("buildLatestManifest", () => {
  it("生成 Tauri v2 静态清单结构", () => {
    const manifest = buildLatestManifest({
      version: "1.2.0",
      notes: "说明",
      pubDate: "2026-10-18T00:00:00.000Z",
      url: "https://example.com/VibeAcross_1.2.0_x64-setup.exe",
      signature: SIGNATURE,
    });

    expect(manifest.version).toBe("1.2.0");
    expect(manifest.notes).toBe("说明");
    expect(manifest.pub_date).toBe("2026-10-18T00:00:00.000Z");
    expect(Object.keys(manifest.platforms)).toEqual([SUPPORTED_PLATFORM]);
    expect(manifest.platforms[SUPPORTED_PLATFORM].signature).toBe(SIGNATURE);
    expect(manifest.platforms[SUPPORTED_PLATFORM].url).toBe(
      "https://example.com/VibeAcross_1.2.0_x64-setup.exe",
    );
  });

  it("默认平台键为 windows-x86_64", () => {
    const manifest = buildLatestManifest({
      version: "1.0.1",
      url: "https://example.com/a.exe",
      signature: SIGNATURE,
    });
    expect(manifest.platforms).toHaveProperty("windows-x86_64");
  });

  it("signature 只接受 .sig 文件内容，拒绝路径", () => {
    expect(() =>
      buildLatestManifest({
        version: "1.2.0",
        url: "https://example.com/a.exe",
        signature: "bundle/VibeAcross_1.2.0_x64-setup.exe.sig",
      }),
    ).toThrow(/signature/);
  });
});

describe("validateLatestManifest", () => {
  it("接受合法清单", () => {
    expect(() => validateLatestManifest(baseManifest())).not.toThrow();
  });

  it("拒绝非法版本号", () => {
    const manifest = baseManifest();
    manifest.version = "v1.2";
    expect(() => validateLatestManifest(manifest)).toThrow(/version/);
  });

  it("拒绝非法发布日期", () => {
    const manifest = baseManifest();
    manifest.pub_date = "not-a-date";
    expect(() => validateLatestManifest(manifest)).toThrow(/pub_date/);
  });

  it("拒绝空的 platforms", () => {
    const manifest = baseManifest();
    manifest.platforms = {};
    expect(() => validateLatestManifest(manifest)).toThrow(/platforms/);
  });

  it("拒绝非 http(s) 的下载地址", () => {
    const manifest = baseManifest();
    manifest.platforms[SUPPORTED_PLATFORM].url = "file:///tmp/a.zip";
    expect(() => validateLatestManifest(manifest)).toThrow(/url/);
  });

  it("拒绝空签名", () => {
    const manifest = baseManifest();
    manifest.platforms[SUPPORTED_PLATFORM].signature = "   ";
    expect(() => validateLatestManifest(manifest)).toThrow(/签名/);
  });
});

describe("readSignatureFile", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "vibeacross-manifest-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("读取 .sig 文件的文本内容", async () => {
    const file = join(dir, "artifact.sig");
    await writeFile(file, `${SIGNATURE}\n`, "utf8");
    await expect(readSignatureFile(file)).resolves.toBe(SIGNATURE);
  });
});
