import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateMinisignKeyPair, signMinisign } from "./minisign.mjs";
import { assertRepoVersions, verifyUpdateRelease } from "./verify-update-release.mjs";

const VERSION = "1.2.0";
const dirs = [];

function makeRepo(version = VERSION) {
  const root = mkdtempSync(join(tmpdir(), "vibeacross-repo-"));
  dirs.push(root);
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version, plugins: { updater: { pubkey: "" } } }),
  );
  writeFileSync(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "x"\nversion = "${version}"\n`);
  return root;
}

function writeSigned(dir, name, pair, { version = VERSION, bytes = `${name}-bytes` } = {}) {
  const file = join(dir, name);
  const data = Buffer.from(bytes);
  writeFileSync(file, data);
  writeFileSync(
    `${file}.sig`,
    signMinisign(data, {
      privateKey: pair.privateKey,
      keyId: pair.keyId,
      trustedComment: `timestamp:1\tfile:${name}\tversion:${version}`,
    }),
  );
  return file;
}

function makeBundle(pair, opts = {}) {
  const bundle = mkdtempSync(join(tmpdir(), "vibeacross-bundle-"));
  dirs.push(bundle);
  mkdirSync(join(bundle, "nsis"));
  mkdirSync(join(bundle, "msi"));
  writeSigned(join(bundle, "nsis"), `VibeAcross_${VERSION}_x64-setup.exe`, pair, opts.exe);
  writeSigned(join(bundle, "msi"), `VibeAcross_${VERSION}_x64_zh-CN.msi`, pair, opts.msi);
  return bundle;
}

function baseOptions(bundle, pair, extra = {}) {
  return {
    bundleDir: bundle,
    version: VERSION,
    pubkey: pair.publicKey,
    repo: "zgit-t/VibeAcross",
    tag: `v${VERSION}`,
    ...extra,
  };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("verify-update-release", () => {
  it("签名有效时通过并生成正确的 latest.json", () => {
    const pair = generateMinisignKeyPair();
    const bundle = makeBundle(pair);
    const { manifest, version } = verifyUpdateRelease(baseOptions(bundle, pair));
    expect(version).toBe(VERSION);
    const entry = manifest.platforms["windows-x86_64"];
    expect(entry.url).toContain(`VibeAcross_${VERSION}_x64-setup.exe`);
    expect(entry.signature).toBe(entry.signature.trim());
  });

  it("签名版本与目标版本不一致时失败", () => {
    const pair = generateMinisignKeyPair();
    const bundle = makeBundle(pair, { exe: { version: "1.1.0" } });
    expect(() => verifyUpdateRelease(baseOptions(bundle, pair))).toThrow(/版本/);
  });

  it("安装包被篡改时失败", () => {
    const pair = generateMinisignKeyPair();
    const bundle = makeBundle(pair);
    const exe = join(bundle, "nsis", `VibeAcross_${VERSION}_x64-setup.exe`);
    writeFileSync(exe, "tampered");
    expect(() => verifyUpdateRelease(baseOptions(bundle, pair))).toThrow(/验签失败/);
  });

  it("缺少签名文件时失败", () => {
    const pair = generateMinisignKeyPair();
    const bundle = makeBundle(pair);
    rmSync(join(bundle, "nsis", `VibeAcross_${VERSION}_x64-setup.exe.sig`));
    expect(() => verifyUpdateRelease(baseOptions(bundle, pair))).toThrow(/缺少签名文件/);
  });

  it("签名早于 --since 时判定为旧残留并失败", () => {
    const pair = generateMinisignKeyPair();
    const bundle = makeBundle(pair);
    const since = new Date(Date.now() + 60_000).toISOString();
    expect(() => verifyUpdateRelease(baseOptions(bundle, pair, { since }))).toThrow(/残留/);
  });

  it("找不到任何安装包时失败", () => {
    const pair = generateMinisignKeyPair();
    const empty = mkdtempSync(join(tmpdir(), "vibeacross-empty-"));
    dirs.push(empty);
    expect(() => verifyUpdateRelease(baseOptions(empty, pair))).toThrow(/未找到/);
  });

  it("仓库内三处版本不一致时失败", () => {
    const root = makeRepo(VERSION);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.1.0" }));
    expect(() => assertRepoVersions(VERSION, root)).toThrow(/package.json/);
  });

  it("仓库内三处版本一致时通过", () => {
    const root = makeRepo(VERSION);
    expect(assertRepoVersions(VERSION, root)).toHaveLength(3);
  });
});
