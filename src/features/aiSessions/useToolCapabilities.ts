import { useEffect, useMemo, useState } from "react";
import { useRevision } from "../../context/RevisionContext";
import { sessionCapabilities } from "../../services/sessions";
import type { NativeSessionCapabilities } from "../../types/domain";

export interface ToolCapabilitiesResult {
  /** 内置工具 id → 能力矩阵；尚未取到（加载中 / 查询失败）时为 undefined。 */
  capabilities: Record<string, NativeSessionCapabilities>;
  loading: boolean;
}

/**
 * 按内置工具 id 批量查询原生会话能力矩阵。
 *
 * 能力必须来自后端「支持 / 不支持 / 尚未核实」的真实标注，前端绝不假设某工具
 * 支持打开历史会话。查询失败时保持「未取到」状态，调用方据此按「不可用」处理，
 * 绝不当作支持。工具集合变化或数据版本号变化时重新拉取。
 */
export function useToolCapabilities(toolIds: string[]): ToolCapabilitiesResult {
  const { desktopAvailable, revision } = useRevision();
  const key = useMemo(
    () => Array.from(new Set(toolIds.filter(Boolean))).sort().join("\n"),
    [toolIds],
  );
  const [capabilities, setCapabilities] = useState<
    Record<string, NativeSessionCapabilities>
  >({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    if (!desktopAvailable || ids.length === 0) {
      setCapabilities({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      ids.map(async (id) => [id, await sessionCapabilities(id)] as const),
    )
      .then((entries) => {
        if (cancelled) {
          return;
        }
        const next: Record<string, NativeSessionCapabilities> = {};
        for (const [id, caps] of entries) {
          next[id] = caps;
        }
        setCapabilities(next);
      })
      .catch(() => {
        if (!cancelled) {
          setCapabilities({});
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, desktopAvailable, revision]);

  return { capabilities, loading };
}
