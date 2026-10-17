import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetUpdaterForTesting,
  __setBackendForTesting,
  __setCurrentVersionForTesting,
  checkForUpdates,
  dismissUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  isAutoCheckSnoozed,
} from "./updater";
import type { UpdateBackend, UpdateHandle } from "./updater";

/**
 * 用例中固定的「当前版本」。
 * 通过 __setCurrentVersionForTesting 注入，避免与 package.json 的真实版本号耦合。
 */
const CURRENT_VERSION = "1.1.0";
const NEWER_VERSION = "1.2.0";

function makeHandle(version: string): UpdateHandle & {
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    version,
    notes: "notes",
    publishedAt: "2026-01-01T00:00:00.000Z",
    download: vi.fn(async (onProgress) => {
      onProgress({ downloaded: 50, total: 100 });
      onProgress({ downloaded: 100, total: 100 });
    }),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

function makeBackend(handle: UpdateHandle | null): UpdateBackend & {
  check: ReturnType<typeof vi.fn>;
  relaunch: ReturnType<typeof vi.fn>;
} {
  return {
    check: vi.fn(async () => handle),
    relaunch: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  __resetUpdaterForTesting();
  __setCurrentVersionForTesting(CURRENT_VERSION);
});

afterEach(() => {
  __resetUpdaterForTesting();
});

describe("checkForUpdates", () => {
  it("无可用更新时进入 upToDate", async () => {
    __setBackendForTesting(makeBackend(null));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("upToDate");
    expect(getUpdateState().lastCheckedAt).not.toBeNull();
  });

  it("远端版本低于当前版本时视为最新", async () => {
    __setBackendForTesting(makeBackend(makeHandle("1.0.0")));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("upToDate");
  });

  it("远端版本等于当前版本时视为最新", async () => {
    __setBackendForTesting(makeBackend(makeHandle(CURRENT_VERSION)));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("upToDate");
  });

  it("发现更高版本时进入 available", async () => {
    const handle = makeHandle("99.0.0");
    __setBackendForTesting(makeBackend(handle));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("available");
    expect(getUpdateState().version).toBe("99.0.0");
  });

  it("当前 1.1.0、远端 1.2.0 时识别为新版本", async () => {
    __setCurrentVersionForTesting(CURRENT_VERSION);
    __setBackendForTesting(makeBackend(makeHandle(NEWER_VERSION)));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("available");
    expect(getUpdateState().version).toBe(NEWER_VERSION);
  });

  it("当前版本高于远端版本时不误报新版本", async () => {
    __setCurrentVersionForTesting(NEWER_VERSION);
    __setBackendForTesting(makeBackend(makeHandle(CURRENT_VERSION)));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("upToDate");
    expect(getUpdateState().version).toBeNull();
  });

  it("版本号非法时报 invalidVersion", async () => {
    __setBackendForTesting(makeBackend(makeHandle("not-a-version")));
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("invalidVersion");
  });

  it("后端抛错时进入 error", async () => {
    __setBackendForTesting({
      check: vi.fn(async () => {
        throw new Error("network unreachable");
      }),
      relaunch: vi.fn(async () => undefined),
    });
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("network");
  });

  it("并发调用复用同一次请求（单飞）", async () => {
    const backend = makeBackend(null);
    __setBackendForTesting(backend);
    await Promise.all([checkForUpdates(), checkForUpdates()]);
    expect(backend.check).toHaveBeenCalledTimes(1);
  });
});

function backendThatThrows(message: string): UpdateBackend {
  return {
    check: vi.fn(async () => {
      throw new Error(message);
    }),
    relaunch: vi.fn(async () => undefined),
  };
}

describe("错误分类", () => {
  it("缺少更新清单（404/403）时归类为 invalidResponse", async () => {
    __setBackendForTesting(
      backendThatThrows("Could not fetch a valid release JSON from the remote"),
    );
    await checkForUpdates();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("invalidResponse");
    expect(getUpdateState().errorMessage).toContain("release JSON");
  });

  it("端点返回非 JSON 内容时归类为 invalidResponse", async () => {
    __setBackendForTesting(backendThatThrows("error decoding response body"));
    await checkForUpdates();
    expect(getUpdateState().errorKind).toBe("invalidResponse");
  });

  it("清单缺少当前平台时归类为 invalidResponse", async () => {
    __setBackendForTesting(
      backendThatThrows(
        "the platform `windows-x86_64` was not found in the response `platforms` object",
      ),
    );
    await checkForUpdates();
    expect(getUpdateState().errorKind).toBe("invalidResponse");
  });

  it("签名无法解析时归类为 signature", async () => {
    __setBackendForTesting(
      backendThatThrows(
        "The signature abc could not be decoded, please check if it is a valid base64 string.",
      ),
    );
    await checkForUpdates();
    expect(getUpdateState().errorKind).toBe("signature");
  });

  it("签名版本不匹配时归类为 signature", async () => {
    __setBackendForTesting(
      backendThatThrows(
        "The update was signed for version 1.0.0 but the update endpoint announced version 1.2.0.",
      ),
    );
    await checkForUpdates();
    expect(getUpdateState().errorKind).toBe("signature");
  });

  it("清单缺少必需字段时归类为 invalidResponse", async () => {
    __setBackendForTesting(
      backendThatThrows("missing field `url` at line 1 column 20"),
    );
    await checkForUpdates();
    expect(getUpdateState().errorKind).toBe("invalidResponse");
  });

  it("网络不可用时记录错误而不向外抛出", async () => {
    __setBackendForTesting(
      backendThatThrows("error sending request for url (https://example.com/latest.json)"),
    );
    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("network");
  });
});

describe("downloadUpdate / installUpdate", () => {
  it("下载完成后进入 ready 并记录进度", async () => {
    const handle = makeHandle("99.0.0");
    __setBackendForTesting(makeBackend(handle));
    await checkForUpdates();
    await downloadUpdate();
    expect(getUpdateState().phase).toBe("ready");
    expect(getUpdateState().progress).toBe(1);
    expect(handle.download).toHaveBeenCalledTimes(1);
  });

  it("安装后调用 relaunch", async () => {
    const handle = makeHandle("99.0.0");
    const backend = makeBackend(handle);
    __setBackendForTesting(backend);
    await checkForUpdates();
    await downloadUpdate();
    await installUpdate();
    expect(handle.install).toHaveBeenCalledTimes(1);
    expect(backend.relaunch).toHaveBeenCalledTimes(1);
  });

  it("未检查时下载/安装是空操作", async () => {
    __setBackendForTesting(makeBackend(null));
    await downloadUpdate();
    await installUpdate();
    expect(getUpdateState().phase).toBe("idle");
  });

  it("下载失败时进入 error 而非 ready", async () => {
    const handle = makeHandle("99.0.0");
    handle.download = vi.fn(async () => {
      throw new Error("Download request failed with status: 404 Not Found");
    });
    __setBackendForTesting(makeBackend(handle));
    await checkForUpdates();
    await downloadUpdate();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("download");
  });

  it("签名校验失败时中止安装，不误报成功", async () => {
    const handle = makeHandle("99.0.0");
    handle.install = vi.fn(async () => {
      throw new Error("signature verification failed");
    });
    const backend = makeBackend(handle);
    __setBackendForTesting(backend);
    await checkForUpdates();
    await downloadUpdate();
    await installUpdate();
    expect(getUpdateState().phase).toBe("error");
    expect(getUpdateState().errorKind).toBe("signature");
    expect(backend.relaunch).not.toHaveBeenCalled();
  });
});

describe("dismissUpdate", () => {
  it("忽略更新后回到 idle 并进入静默期", async () => {
    const handle = makeHandle("99.0.0");
    __setBackendForTesting(makeBackend(handle));
    await checkForUpdates();
    await dismissUpdate();
    expect(getUpdateState().phase).toBe("idle");
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(isAutoCheckSnoozed()).toBe(true);
  });

  it("静默期内仍可手动检查更新", async () => {
    const handle = makeHandle("99.0.0");
    __setBackendForTesting(makeBackend(handle));
    await checkForUpdates();
    await dismissUpdate();
    expect(isAutoCheckSnoozed()).toBe(true);

    await checkForUpdates();
    expect(getUpdateState().phase).toBe("available");
    expect(getUpdateState().version).toBe("99.0.0");
  });
});
