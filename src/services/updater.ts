/**
 * 统一的应用内更新服务。
 *
 * 关于页面与设置页面共享同一份状态（通过 `useUpdateState` 订阅），
 * 从而保证「检查中 / 可更新 / 下载中 / 待安装」在任意入口都是一致的。
 *
 * 该服务仅在桌面运行时（Tauri）真正联网与写入；在浏览器预览模式下
 * 会以 `notDesktop` 错误优雅降级，不影响开发时的界面调试。
 */

import { useSyncExternalStore } from "react";
import { APP_VERSION } from "../config/app";
import { t } from "../i18n/translate";
import { isVersionNewer, isValidVersion } from "../utils/semver";
import { isDesktopRuntime } from "./backend";

/** 更新流程所处阶段。 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

/** 更新失败的分类，便于界面给出针对性的说明。 */
export type UpdateErrorKind =
  | "network"
  | "invalidResponse"
  | "invalidVersion"
  | "download"
  | "signature"
  | "install"
  | "notDesktop"
  | "unknown";

export interface UpdateState {
  phase: UpdatePhase;
  /** 目标版本号（可更新 / 下载中 / 待安装时）；其余为 null。 */
  version: string | null;
  /** 发布说明（通常为 Markdown 文本）；无则为 null。 */
  notes: string | null;
  /** 发布日期（ISO 8601 字符串）；无则为 null。 */
  publishedAt: string | null;
  /** 下载进度（0..1）；总大小未知时为 null。 */
  progress: number | null;
  /** 已下载字节数。 */
  downloadedBytes: number;
  /** 总字节数；未知时为 0。 */
  totalBytes: number;
  /** 错误分类；仅在 phase === "error" 时非空。 */
  errorKind: UpdateErrorKind | null;
  /** 面向用户的错误信息（含后端原文）；仅在 phase === "error" 时非空。 */
  errorMessage: string | null;
  /** 最近一次检查的时间戳（毫秒）；从未检查时为 null。 */
  lastCheckedAt: number | null;
}

/** 单个可更新版本句柄（对官方 updater 的 `Update` 的最小封装）。 */
export interface UpdateHandle {
  version: string;
  notes: string | null;
  publishedAt: string | null;
  download: (
    onProgress: (progress: { downloaded: number; total: number }) => void,
  ) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}

/** 更新后端抽象，便于在测试中替换。 */
export interface UpdateBackend {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
}

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 启动后延迟自动检查，避免与首屏加载、工具检测争抢资源。 */
export const AUTO_CHECK_START_DELAY_MS = 10 * 1000;
/** 用户忽略更新后的静默期，期间自动检查不再打扰。 */
export const AUTO_CHECK_SNOOZE_MS = 24 * 60 * 60 * 1000;

const INITIAL_STATE: UpdateState = {
  phase: "idle",
  version: null,
  notes: null,
  publishedAt: null,
  progress: null,
  downloadedBytes: 0,
  totalBytes: 0,
  errorKind: null,
  errorMessage: null,
  lastCheckedAt: null,
};

let state: UpdateState = INITIAL_STATE;
const listeners = new Set<() => void>();
let pendingHandle: UpdateHandle | null = null;
let inFlightCheck: Promise<void> | null = null;
let snoozeUntil = 0;
let backendOverride: UpdateBackend | null = null;
/** 测试用：覆盖当前应用版本，避免用例与 package.json 的版本号耦合。 */
let currentVersionOverride: string | null = null;

/** 当前应用版本；正式运行时即注入的 APP_VERSION。 */
function currentVersion(): string {
  return currentVersionOverride ?? APP_VERSION;
}

function emit(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UpdateState {
  return state;
}

/** 订阅更新状态的 React Hook；任意入口拿到的是同一份状态。 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 读取当前更新状态快照（非 React 代码使用）。 */
export function getUpdateState(): UpdateState {
  return state;
}

/**
 * 根据后端返回的错误信息归类。
 *
 * 匹配顺序即优先级：签名相关优先，其次是清单/响应格式问题，再次是安装与网络。
 * 关键词取自 tauri-plugin-updater 的错误文案（见其 `error.rs`），
 * 例如清单缺失或端点 404/403 时会返回 “Could not fetch a valid release JSON from the remote”。
 */
const ERROR_KEYWORDS: ReadonlyArray<{ kind: UpdateErrorKind; keywords: readonly string[] }> = [
  {
    kind: "signature",
    keywords: ["signature", "verify", "minisign", "tampered", "signed for version"],
  },
  {
    kind: "invalidResponse",
    keywords: [
      "release json",
      "valid release",
      "found in the response",
      "decoding response body",
      "missing field",
      "invalid type",
      "invalid semver",
      "unexpected token",
      "unexpected end of json",
      "invalid json",
      "failed to parse",
    ],
  },
  {
    kind: "install",
    keywords: ["install", "extract", "archive", "temp directory", "escalat"],
  },
  {
    kind: "network",
    keywords: [
      "network",
      "connect",
      "dns",
      "timed out",
      "timeout",
      "sending request",
      "lookup address",
      "unreachable",
      "certificate",
    ],
  },
];

function classifyError(error: unknown): { kind: UpdateErrorKind; message: string } {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const message = raw.trim() || t("update.errorGeneric");
  const lower = message.toLowerCase();
  const matched = ERROR_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => lower.includes(keyword)),
  );
  return { kind: matched?.kind ?? "unknown", message };
}

/** 将下载事件折算为进度；不同版本的插件事件字段略有差异，这里做了兼容。 */
function createProgressTracker(
  onProgress: (progress: { downloaded: number; total: number }) => void,
): (event: unknown) => void {
  let downloaded = 0;
  let total = 0;
  return (event: unknown) => {
    const record = (event ?? {}) as {
      event?: string;
      data?: { contentLength?: number; chunkLength?: number };
    };
    if (record.event === "Started") {
      total = Number(record.data?.contentLength) || 0;
      onProgress({ downloaded, total });
      return;
    }
    if (record.event === "Progress") {
      downloaded += Number(record.data?.chunkLength) || 0;
      onProgress({ downloaded, total });
    }
  };
}

/**
 * 加载官方 updater 后端。
 *
 * 通过动态 import 引入，确保浏览器预览与单元测试环境不会因为缺少
 * Tauri 运行时而在模块加载阶段报错。
 */
async function loadTauriBackend(): Promise<UpdateBackend> {
  const [{ check }, pluginProcess] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  return {
    async check(): Promise<UpdateHandle | null> {
      const update = await check();
      if (!update) {
        return null;
      }
      return {
        version: update.version,
        notes: update.body ?? null,
        publishedAt: update.date ?? null,
        download: async (onProgress) => {
          const track = createProgressTracker(onProgress);
          await update.download((event) => track(event));
        },
        install: () => update.install(),
        close: () => update.close(),
      };
    },
    relaunch: () => pluginProcess.relaunch(),
  };
}

let cachedBackend: UpdateBackend | null = null;

async function ensureBackend(): Promise<UpdateBackend> {
  if (backendOverride) {
    return backendOverride;
  }
  if (!cachedBackend) {
    cachedBackend = await loadTauriBackend();
  }
  return cachedBackend;
}

async function runCheck(): Promise<void> {
  emit({
    phase: "checking",
    errorKind: null,
    errorMessage: null,
    version: null,
    notes: null,
    publishedAt: null,
    progress: null,
    downloadedBytes: 0,
    totalBytes: 0,
  });

  if (!isDesktopRuntime() && !backendOverride) {
    emit({
      phase: "error",
      errorKind: "notDesktop",
      errorMessage: t("update.errorNotDesktop"),
      lastCheckedAt: Date.now(),
    });
    return;
  }

  try {
    const backend = await ensureBackend();
    const handle = await backend.check();
    if (!handle) {
      emit({ phase: "upToDate", lastCheckedAt: Date.now() });
      return;
    }
    if (!isValidVersion(handle.version)) {
      await handle.close().catch(() => undefined);
      emit({
        phase: "error",
        errorKind: "invalidVersion",
        errorMessage: t("update.errorInvalidVersion", { version: handle.version }),
        lastCheckedAt: Date.now(),
      });
      return;
    }
    if (!isVersionNewer(handle.version, currentVersion())) {
      await handle.close().catch(() => undefined);
      emit({ phase: "upToDate", lastCheckedAt: Date.now() });
      return;
    }
    pendingHandle = handle;
    emit({
      phase: "available",
      version: handle.version,
      notes: handle.notes,
      publishedAt: handle.publishedAt,
      lastCheckedAt: Date.now(),
    });
  } catch (error) {
    const { kind, message } = classifyError(error);
    emit({ phase: "error", errorKind: kind, errorMessage: message, lastCheckedAt: Date.now() });
  }
}

/** 检查更新。并发调用会复用同一次请求（单飞）。 */
export function checkForUpdates(): Promise<void> {
  if (!inFlightCheck) {
    inFlightCheck = runCheck().finally(() => {
      inFlightCheck = null;
    });
  }
  return inFlightCheck;
}

/** 下载已发现的更新；下载完成后进入 `ready` 等待用户确认安装。 */
export async function downloadUpdate(): Promise<void> {
  if (!pendingHandle || state.phase !== "available") {
    return;
  }
  emit({ phase: "downloading", progress: 0, downloadedBytes: 0, totalBytes: 0 });
  try {
    await pendingHandle.download(({ downloaded, total }) => {
      emit({
        downloadedBytes: downloaded,
        totalBytes: total,
        progress: total > 0 ? Math.min(downloaded / total, 1) : null,
      });
    });
    emit({ phase: "ready", progress: 1 });
  } catch (error) {
    const { kind, message } = classifyError(error);
    emit({
      phase: "error",
      errorKind: kind === "unknown" ? "download" : kind,
      errorMessage: message,
    });
  }
}

/** 安装已下载的更新，随后自动重启应用。 */
export async function installUpdate(): Promise<void> {
  if (!pendingHandle || state.phase !== "ready") {
    return;
  }
  emit({ phase: "installing" });
  try {
    await pendingHandle.install();
    await (await ensureBackend()).relaunch();
  } catch (error) {
    const { kind, message } = classifyError(error);
    emit({
      phase: "error",
      errorKind: kind === "unknown" ? "install" : kind,
      errorMessage: message,
    });
  }
}

/** 放弃当前发现的更新，并进入自动检查静默期。 */
export async function dismissUpdate(): Promise<void> {
  if (pendingHandle) {
    await pendingHandle.close().catch(() => undefined);
    pendingHandle = null;
  }
  snoozeUntil = Date.now() + AUTO_CHECK_SNOOZE_MS;
  emit({ phase: "idle", version: null, notes: null, publishedAt: null, progress: null });
}

/** 自动检查是否处于静默期（忽略更新后 24 小时内不再自动检查）。 */
export function isAutoCheckSnoozed(): boolean {
  return Date.now() < snoozeUntil;
}

/** 自动检查的间隔与启动延迟，供调度方使用。 */
export const AUTO_CHECK_INTERVAL = AUTO_CHECK_INTERVAL_MS;

// —— 测试专用 ——

/** 注入测试用后端。传 null 恢复真实后端。 */
export function __setBackendForTesting(backend: UpdateBackend | null): void {
  backendOverride = backend;
}

/** 注入测试用当前版本。传 null 恢复真实 APP_VERSION。 */
export function __setCurrentVersionForTesting(version: string | null): void {
  currentVersionOverride = version;
}

/** 重置服务内部状态，供测试隔离用例。 */
export function __resetUpdaterForTesting(): void {
  state = INITIAL_STATE;
  pendingHandle = null;
  inFlightCheck = null;
  snoozeUntil = 0;
  backendOverride = null;
  currentVersionOverride = null;
  cachedBackend = null;
  for (const listener of listeners) {
    listener();
  }
}
