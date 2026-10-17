#!/usr/bin/env node
/**
 * 生成 Tauri v2 静态更新清单 latest.json（用于手动发布）。
 *
 * 自动发布请使用 .github/workflows/release.yml：tauri-action 会自行生成并上传
 * latest.json 与 *.sig。本脚本供无法使用 CI 时手动生成清单之用。
 *
 * 用法：
 *   node scripts/generate-update-manifest.mjs \
 *     --version 1.2.0 \
 *     --repo zgit-t/VibeAcross --tag v1.2.0 \
 *     --artifact VibeAcross_1.2.0_x64-setup.exe \
 *     --signature path/to/VibeAcross_1.2.0_x64-setup.exe.sig \
 *     --notes-file docs/RELEASE_NOTES.md --out latest.json
 *
 * 也可以直接用 --url 指定下载地址（与 --repo/--tag 二选一）。
 *
 * 关于更新包：本项目使用 `bundle.createUpdaterArtifacts: true`，在 Windows 上
 * 普通 NSIS 安装包 `*.exe`（或 MSI）即由更新器复用，并生成同名 `.sig`：
 *   VibeAcross_1.2.0_x64-setup.exe      （更新包）
 *   VibeAcross_1.2.0_x64-setup.exe.sig  （签名）
 * 注意 `.sig` 文件内容中的 `version:` 必须与清单 version 一致，否则更新器会以
 * SignedVersionMismatch 拒绝安装。
 *
 * 重要：platforms["windows-x86_64"].signature 必须是 .sig 文件的**内容**
 *      （即 bundler 生成的 base64 文本），而不是签名文件的路径。
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 本项目仅发布 Windows x64，清单里对应的平台键。 */
export const SUPPORTED_PLATFORM = "windows-x86_64";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** 依据仓库、标签与资产名拼接 GitHub Release 下载地址。 */
export function assetDownloadUrl(repo, tag, assetName) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`无效的仓库名：${repo}（应为 owner/repo）`);
  }
  if (!tag) {
    throw new Error("缺少发布标签（tag）");
  }
  if (!assetName) {
    throw new Error("缺少更新资产名（artifact）");
  }
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
}

/** 组装一份最新的更新清单对象（不写入磁盘）。 */
export function buildLatestManifest({
  version,
  notes = null,
  pubDate = new Date().toISOString(),
  platform = SUPPORTED_PLATFORM,
  url,
  signature,
}) {
  const manifest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      [platform]: { signature, url },
    },
  };
  validateLatestManifest(manifest);
  return manifest;
}

/** 校验清单结构；不合法时抛出带说明的错误。 */
export function validateLatestManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("清单必须是一个对象");
  }
  if (typeof manifest.version !== "string" || !SEMVER_PATTERN.test(manifest.version)) {
    throw new Error(`清单 version 不是合法语义化版本：${String(manifest.version)}`);
  }
  if (manifest.notes != null && typeof manifest.notes !== "string") {
    throw new Error("清单 notes 必须是字符串或 null");
  }
  if (typeof manifest.pub_date !== "string" || Number.isNaN(Date.parse(manifest.pub_date))) {
    throw new Error(`清单 pub_date 不是合法的日期字符串：${String(manifest.pub_date)}`);
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== "object" || Object.keys(platforms).length === 0) {
    throw new Error("清单 platforms 至少需要包含一个平台");
  }
  for (const [name, entry] of Object.entries(platforms)) {
    if (!name) {
      throw new Error("平台键不能为空");
    }
    if (!entry || typeof entry !== "object") {
      throw new Error(`平台 ${name} 的配置必须是对象`);
    }
    if (typeof entry.url !== "string" || !/^https?:\/\//.test(entry.url)) {
      throw new Error(`平台 ${name} 的 url 必须是 http(s) 地址：${String(entry.url)}`);
    }
    validateSignature(entry.signature, name);
  }
  return manifest;
}

function validateSignature(signature, platform) {
  if (typeof signature !== "string" || signature.trim() === "") {
    throw new Error(`平台 ${platform} 缺少签名（signature）`);
  }
  // 常见误用：把 .sig 文件路径写进清单。真正的签名内容是带换行的 base64 文本。
  if (signature.trim().endsWith(".sig") && !signature.includes("\n")) {
    throw new Error(
      `平台 ${platform} 的 signature 看起来是文件路径（${signature}），` +
        "请填入 .sig 文件的文本内容。",
    );
  }
}

/** 读取 .sig 文件并返回其文本内容（已去除首尾空白）。 */
export async function readSignatureFile(signaturePath) {
  const content = await readFile(signaturePath, "utf8");
  return content.trim();
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
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

function printUsage() {
  console.error(
    [
      "用法：node scripts/generate-update-manifest.mjs --version <版本> [选项]",
      "",
      "  --version <v>        目标版本号（必填）",
      "  --signature <path>   更新资产的 .sig 文件路径（必填）",
      "  --url <url>          更新资产下载地址（与 --repo/--tag/--artifact 二选一）",
      "  --repo <owner/repo>  GitHub 仓库，用于拼接下载地址",
      "  --tag <tag>          发布标签（如 v1.2.0）",
      "  --artifact <name>    更新资产名（Windows 上即 NSIS 的 *.exe）",
      "  --notes <text>       更新说明文本",
      "  --notes-file <path>  从文件读取更新说明",
      "  --pub-date <iso>     发布日期（默认当前时间）",
      "  --platform <key>     平台键（默认 windows-x86_64）",
      "  --out <path>         输出文件（默认 latest.json）",
    ].join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.version) {
    printUsage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const url =
    options.url ??
    assetDownloadUrl(options.repo, options.tag, options.artifact);

  const notes = options["notes-file"]
    ? (await readFile(options["notes-file"], "utf8")).trim()
    : (options.notes ?? null);

  const manifest = buildLatestManifest({
    version: options.version,
    notes,
    pubDate: options["pub-date"],
    platform: options.platform,
    url,
    signature: await readSignatureFile(options.signature),
  });

  const outPath = resolve(options.out ?? "latest.json");
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`已写入更新清单：${outPath}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
