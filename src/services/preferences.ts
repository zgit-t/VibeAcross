/**
 * 本地偏好设置的统一读写入口。
 *
 * 仅用于保存界面偏好（如主题），不用于业务数据持久化。
 * 业务数据统一由 SQLite（Rust 后端）管理。
 * 当 localStorage 不可用时自动退化为内存存储，保证应用不崩溃。
 */

const memoryStore = new Map<string, string>();

function isStorageAvailable(): boolean {
  try {
    const probe = "__vibeacross_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const storageAvailable =
  typeof window !== "undefined" && isStorageAvailable();

export function readPreference(key: string): string | null {
  if (!storageAvailable) {
    return memoryStore.get(key) ?? null;
  }
  return window.localStorage.getItem(key);
}

export function writePreference(key: string, value: string): void {
  if (!storageAvailable) {
    memoryStore.set(key, value);
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}
