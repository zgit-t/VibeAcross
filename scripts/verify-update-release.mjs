#!/usr/bin/env node
/**
 * 发布前校验：确认本次构建的更新包、签名与 latest.json 一一对应且来自同一次构建。
 *
 * 只有全部通过才会写出 latest.json 与 release-assets.txt（供上传步骤使用）；
 * 任一失败都会以非零退出码终止，从而阻止后续发布步骤。不会修改已发布的旧资产。
 *
 * 校验内容：
 *   1. 每个安装包（NSIS *.exe、MSI *.msi）都存在同目录同名 *.sig；
 *   2. 用 tauri.conf.json 的 pubkey 对安装包做真实 minisign 验签（Ed25519）；
 *   3. 签名可信注释中的 version: 与目标发布版本一致；
 *   4. 签名文件不是上一次构建的残留（--since 之后生成）；
 *   5. latest.json 的 version/platform/url/signature 与实际更新包一致；
 *   6. （可选 --check-repo-versions）package.json / tauri.conf.json / Cargo.toml 版本一致。
 *
 * 用法：
 *   node scripts/verify-update-release.mjs --bundle-dir src-tauri/target/release/bundle \
 *     --repo zgit-t/VibeAcross --tag v1.2.0 --out latest.json --since 2026-01-01T00:00:00Z \
 *     --check-repo-versions --assets-out release-assets.txt
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assetDownloadUrl,
  buildLatestManifest,
  SUPPORTED_PLATFORM,
  validateLatestManifest,
} from "./generate-update-manifest.mjs";
import { verifyMinisign } from "./minisign.mjs";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

function readJsonVersion(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (typeof data.version !== "string") {
    fail(`${path} 缺少 version 字段`);
  }
  return data.version;
}

function readCargoVersion(path) {
  const text = readFileSync(path, "utf8");
  const section = text.split(/^\[/m);
  const pkg = section.find((part) => part.startsWith("package]"));
  const match = pkg && pkg.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) fail(`${path} 中未找到 [package] version`);
  return match[1];
}

/** 校验仓库内三处版本号一致，且等于目标发布版本。 */
export function assertRepoVersions(expectedVersion, repoRoot = ".") {
  const sources = [
    ["package.json", readJsonVersion(join(repoRoot, "package.json"))],
    ["src-tauri/tauri.conf.json", readJsonVersion(join(repoRoot, "src-tauri/tauri.conf.json"))],
    ["src-tauri/Cargo.toml", readCargoVersion(join(repoRoot, "src-tauri/Cargo.toml"))],
  ];
  for (const [name, version] of sources) {
    if (version !== expectedVersion) {
      fail(`${name} 的版本为 ${version}，与目标发布版本 ${expectedVersion} 不一致`);
    }
  }
  return sources;
}

function readPubkey(options) {
  if (typeof options.pubkey === "string") return options.pubkey;
  const confPath = options.config ?? join(options["repo-root"] ?? ".", "src-tauri/tauri.conf.json");
  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  const pubkey = conf?.plugins?.updater?.pubkey;
  if (typeof pubkey !== "string" || pubkey.trim() === "") {
    fail(`${confPath} 中缺少 plugins.updater.pubkey`);
  }
  return pubkey;
}

function listInstallers(bundleDir) {
  const installers = [];
  const nsisDir = join(bundleDir, "nsis");
  const msiDir = join(bundleDir, "msi");
  for (const [dir, pattern] of [
    [nsisDir, (name) => name.endsWith("-setup.exe")],
    [msiDir, (name) => name.endsWith(".msi")],
  ]) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (pattern(name)) installers.push(join(dir, name));
    }
  }
  return installers;
}

/**
 * 执行校验。options: { version?, bundleDir, pubkey?, config?, repoRoot?, since?, url?, repo?, tag? }。
 * 返回 { version, manifest, updaterArtifact, assets }。
 */
export function verifyUpdateRelease(options) {
  const bundleDir = options.bundleDir ?? options["bundle-dir"];
  if (!bundleDir) fail("缺少 --bundle-dir");

  const repoRoot = options.repoRoot ?? options["repo-root"] ?? ".";
  const version =
    options.version ?? readJsonVersion(join(repoRoot, "package.json"));

  if (options["check-repo-versions"]) {
    assertRepoVersions(version, repoRoot);
  }

  const before = options.since ? Date.parse(options.since) : null;
  if (before != null && Number.isNaN(before)) fail(`--since 不是合法时间：${options.since}`);

  const pubkey = readPubkey({ ...options, "repo-root": repoRoot });
  const installers = listInstallers(bundleDir);
  if (installers.length === 0) fail(`在 ${bundleDir} 下未找到任何安装包（*.exe/*.msi）`);

  const verified = [];
  for (const installer of installers) {
    const sigPath = `${installer}.sig`;
    let sigText;
    try {
      sigText = readFileSync(sigPath, "utf8");
    } catch {
      fail(`缺少签名文件：${sigPath}（构建可能失败或使用了 --no-sign）`);
    }
    if (before != null && statSync(sigPath).mtimeMs < before) {
      fail(
        `签名 ${sigPath} 早于本次构建开始时间，疑似上一次构建的残留，拒绝发布`,
      );
    }
    const result = verifyMinisign({
      publicKey: pubkey,
      signature: sigText,
      data: readFileSync(installer),
    });
    if (!result.valid) {
      fail(`${basename(installer)} 验签失败：${result.reason}`);
    }
    if (result.version !== version) {
      fail(
        `${basename(installer)} 签名绑定的版本为 ${result.version}，与目标版本 ${version} 不一致`,
      );
    }
    verified.push({ installer, sigPath, sigText });
  }

  const updater = verified.find((entry) => entry.installer.endsWith("-setup.exe"));
  if (!updater) fail("未找到 NSIS 更新包（*-setup.exe），无法生成 latest.json");

  const url =
    options.url ??
    assetDownloadUrl(options.repo, options.tag, basename(updater.installer));

  const manifest = buildLatestManifest({
    version,
    notes: options.notes ?? null,
    pubDate: new Date().toISOString(),
    platform: SUPPORTED_PLATFORM,
    url,
    signature: updater.sigText,
  });
  validateLatestManifest(manifest);

  return { version, manifest, updaterArtifact: updater, verified };
}

function printUsage() {
  console.error(
    [
      "用法：node scripts/verify-update-release.mjs --bundle-dir <目录> [选项]",
      "",
      "  --bundle-dir <dir>        构建产物目录（src-tauri/target/release/bundle）",
      "  --version <v>             目标版本（默认取 package.json）",
      "  --repo <owner/repo>       用于拼接下载地址（与 --url 二选一）",
      "  --tag <tag>               发布标签",
      "  --url <url>               直接指定更新包下载地址",
      "  --pubkey <base64>         覆盖公钥（默认读 tauri.conf.json）",
      "  --config <path>           tauri.conf.json 路径",
      "  --repo-root <dir>         仓库根目录（默认当前目录）",
      "  --since <ISO>             构建开始时间，用于识别旧签名残留",
      "  --check-repo-versions     校验仓库内三处版本号一致",
      "  --only-check-versions     仅校验版本号一致后退出（无需 --bundle-dir）",
      "  --out <path>              输出 latest.json（默认 latest.json）",
      "  --assets-out <path>       输出待上传文件清单",
    ].join("\n"),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options["only-check-versions"]) {
    const repoRoot = options["repo-root"] ?? ".";
    const version = options.version ?? readJsonVersion(join(repoRoot, "package.json"));
    assertRepoVersions(version, repoRoot);
    console.log(`版本一致：${version}（package.json / tauri.conf.json / Cargo.toml）`);
    return;
  }

  if (!options["bundle-dir"]) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { version, manifest, verified } = verifyUpdateRelease(options);

  const outPath = resolve(options.out ?? "latest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options["assets-out"]) {
    const assets = [
      ...verified.flatMap((entry) => [entry.installer, entry.sigPath]),
      outPath,
    ];
    writeFileSync(resolve(options["assets-out"]), `${assets.join("\n")}\n`, "utf8");
  }

  console.log(`校验通过：版本 ${version}`);
  for (const entry of verified) {
    console.log(`  ✓ ${basename(entry.installer)} ↔ ${basename(entry.sigPath)}`);
  }
  console.log(`  ✓ latest.json -> ${manifest.platforms[SUPPORTED_PLATFORM].url}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`发布校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
