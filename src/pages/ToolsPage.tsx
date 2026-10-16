import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  HelpCircle,
  Plus,
  RefreshCw,
  SearchX,
  Settings2,
  Star,
  StarOff,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTools } from "../context/ToolsContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ToolConfigDialog } from "../features/tools/ToolConfigDialog";
import {
  STATUS_FILTERS,
  TOOL_TYPE_LABEL,
  getStatusLabel,
  getStatusTone,
} from "../features/tools/data";
import type { ToolEntry, ToolStatus } from "../types/domain";
import styles from "./ToolsPage.module.css";

type StatusFilter = ToolStatus | "all";

const STATUS_ICONS: Record<ToolStatus, ReactNode> = {
  detected: <CheckCircle2 size={11} aria-hidden="true" />,
  notDetected: <CircleDashed size={11} aria-hidden="true" />,
  notInstalled: <CircleSlash size={11} aria-hidden="true" />,
  pathMissing: <AlertTriangle size={11} aria-hidden="true" />,
  unverified: <HelpCircle size={11} aria-hidden="true" />,
  detectionFailed: <XCircle size={11} aria-hidden="true" />,
};

function formatTimestamp(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** 开发工具管理页面：检测本机安装、手动配置路径与默认工具。 */
export function ToolsPage() {
  const {
    tools,
    lastDetectionAt,
    loading,
    detecting,
    error,
    desktopAvailable,
    detect,
    setDefaultTool,
    removeTool,
    clearError,
  } = useTools();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [presetToolId, setPresetToolId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ToolEntry | null>(null);
  const [removing, setRemoving] = useState<ToolEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tools.filter((tool) => {
      const matchesQuery =
        !keyword ||
        tool.name.toLowerCase().includes(keyword) ||
        tool.vendor.toLowerCase().includes(keyword) ||
        tool.description.toLowerCase().includes(keyword) ||
        (tool.executablePath ?? "").toLowerCase().includes(keyword);
      const matchesFilter = filter === "all" || tool.status === filter;
      return matchesQuery && matchesFilter;
    });
  }, [tools, query, filter]);

  const detectedCount = tools.filter((tool) => tool.installed).length;
  const lastDetectionLabel = formatTimestamp(lastDetectionAt);

  async function safely(action: () => Promise<void>) {
    try {
      await action();
    } catch {
      // 错误信息已写入 ToolsContext，由页面统一展示。
    }
  }

  function openAddDialog(toolId: string | null) {
    setPresetToolId(toolId);
    setEditing(null);
    setAddOpen(true);
  }

  function openEditDialog(tool: ToolEntry) {
    setPresetToolId(null);
    setEditing(tool);
    setAddOpen(true);
  }

  function closeDialog() {
    setAddOpen(false);
    setEditing(null);
    setPresetToolId(null);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Tools"
        description="检测并管理本机已安装的 AI 编程工具。"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              onClick={() => void safely(() => detect())}
              disabled={!desktopAvailable || detecting}
            >
              {detecting ? "检测中…" : "重新检测"}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={15} aria-hidden="true" />}
              onClick={() => openAddDialog(null)}
              disabled={!desktopAvailable}
            >
              Add Tool
            </Button>
          </>
        }
      />

      <Notice tone="info">
        检测仅在本机进行，不会上传任何数据、不会下载或安装软件。
        {lastDetectionLabel && ` 最近一次全量检测：${lastDetectionLabel}。`}
      </Notice>

      {!desktopAvailable && (
        <Notice tone="warning" title="不可用">
          当前不在桌面应用中运行，无法读取本机安装信息。
        </Notice>
      )}

      {error && (
        <Notice tone="danger" title="操作失败">
          {error}
          <button type="button" className={styles.linkButton} onClick={clearError}>
            知道了
          </button>
        </Notice>
      )}

      <div className={styles.toolbar}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="搜索工具名称、提供方或路径…"
          label="搜索工具"
        />
        <SegmentedControl
          ariaLabel="按检测状态筛选"
          size="sm"
          options={STATUS_FILTERS}
          value={filter}
          onChange={setFilter}
        />
        <span className={styles.count}>
          {filtered.length} / {tools.length} 个工具 · 已检测到 {detectedCount}
        </span>
      </div>

      <div className={styles.listWrap}>
        {loading ? (
          <p className={styles.loading}>正在读取工具列表…</p>
        ) : tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="暂无工具信息"
            description="在桌面应用中运行后即可检测本机已安装的工具。"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="没有匹配的工具"
            description="尝试调整搜索关键词或筛选条件。"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                清除筛选
              </Button>
            }
          />
        ) : (
          <ul className={styles.list}>
            {filtered.map((tool) => {
              const isPlaceholder = tool.source === "builtin";
              const isCatalogTool = !tool.isCustom;
              return (
                <li key={tool.id} className={styles.row}>
                  <span className={styles.icon} aria-hidden="true">
                    <Wrench size={16} />
                  </span>

                  <div className={styles.main}>
                    <div className={styles.titleRow}>
                      <span className={styles.name}>{tool.name}</span>
                      {tool.isDefault && <Badge tone="accent">默认</Badge>}
                      {tool.isCustom && <Badge tone="accent">自定义</Badge>}
                      {tool.source === "auto" && <Badge tone="neutral">自动检测</Badge>}
                      {tool.source === "manual" && <Badge tone="neutral">手动配置</Badge>}
                      <span className={styles.type}>
                        {TOOL_TYPE_LABEL[tool.toolType]}
                      </span>
                    </div>
                    <span className={styles.description}>
                      {tool.executablePath ?? tool.commandName ?? tool.description}
                    </span>
                    <span className={styles.meta}>
                      {tool.version && <>版本 {tool.version} · </>}
                      {tool.detectedAt && (
                        <>检测于 {formatTimestamp(tool.detectedAt)} · </>
                      )}
                      {tool.lastError ? (
                        tool.lastError
                      ) : !tool.autoDetectReliable ? (
                        tool.detectionNote
                      ) : (
                        tool.detectionMethod ?? tool.detectionNote
                      )}
                    </span>
                  </div>

                  <span className={styles.vendor}>{tool.vendor}</span>

                  <Badge
                    tone={getStatusTone(tool.status)}
                    icon={STATUS_ICONS[tool.status]}
                  >
                    {getStatusLabel(tool.status)}
                  </Badge>

                  <div className={styles.actions}>
                    {isPlaceholder ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openAddDialog(tool.toolId)}
                          disabled={!desktopAvailable}
                        >
                          手动配置
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void safely(() => detect(tool.toolId))}
                          disabled={!desktopAvailable || detecting}
                        >
                          检测
                        </Button>
                      </>
                    ) : (
                      <>
                        {tool.installed && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={
                              tool.isDefault ? (
                                <StarOff size={14} aria-hidden="true" />
                              ) : (
                                <Star size={14} aria-hidden="true" />
                              )
                            }
                            disabled={busyId === tool.id}
                            onClick={() => {
                              setBusyId(tool.id);
                              void safely(() =>
                                setDefaultTool(tool.isDefault ? null : tool.id),
                              ).finally(() => setBusyId(null));
                            }}
                          >
                            {tool.isDefault ? "取消默认" : "设为默认"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Settings2 size={14} aria-hidden="true" />}
                          onClick={() => openEditDialog(tool)}
                          disabled={!desktopAvailable}
                        >
                          配置
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={14} aria-hidden="true" />}
                          onClick={() => setRemoving(tool)}
                          disabled={!desktopAvailable}
                        >
                          移除
                        </Button>
                        {isCatalogTool && tool.source !== "auto" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void safely(() => detect(tool.toolId))}
                            disabled={!desktopAvailable || detecting}
                          >
                            检测
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ToolConfigDialog
        open={addOpen}
        onClose={closeDialog}
        entry={editing}
        presetToolId={presetToolId}
      />

      <ConfirmDialog
        open={removing !== null}
        title="移除工具配置"
        description={
          removing
            ? `将从列表中移除「${removing.name}」的本地配置记录。这不会卸载或删除任何文件。`
            : ""
        }
        confirmLabel="移除"
        tone="danger"
        busy={busyId === removing?.id}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) {
            return;
          }
          const target = removing;
          setBusyId(target.id);
          void safely(() => removeTool(target.id)).finally(() => {
            setBusyId(null);
            setRemoving(null);
          });
        }}
      >
        <p className={styles.confirmNote}>
          移除后可以随时通过「重新检测」或「手动配置」重新添加。
        </p>
      </ConfirmDialog>
    </div>
  );
}
