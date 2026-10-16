import { useCallback, useEffect, useState } from "react";
import { getAppInfo, greet, isDesktopRuntime } from "../services/backend";
import type { AppInfo } from "../types/backend";

interface BackendState {
  /** 当前是否运行在 Tauri 宿主中。 */
  isDesktop: boolean;
  /** Rust 后端返回的应用信息。 */
  appInfo: AppInfo | null;
  /** 后端信息加载过程中的错误信息。 */
  error: string | null;
  /** 是否正在请求后端。 */
  loading: boolean;
}

/**
 * 加载 Rust 后端基础信息，并暴露最小通信示例所需的调用方法。
 * 业务逻辑集中在 Hook 内，组件只负责渲染。
 */
export function useBackendInfo() {
  const [state, setState] = useState<BackendState>({
    isDesktop: isDesktopRuntime(),
    appInfo: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setState((prev) => ({
        ...prev,
        isDesktop: false,
        loading: false,
        error: "当前运行在浏览器预览模式，未连接到 Rust 后端。",
      }));
      return;
    }

    let cancelled = false;

    getAppInfo()
      .then((appInfo) => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, appInfo, loading: false }));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const requestGreeting = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("请输入名称后再向 Rust 后端发送请求。");
    }
    return greet(trimmed);
  }, []);

  return { ...state, requestGreeting };
}
