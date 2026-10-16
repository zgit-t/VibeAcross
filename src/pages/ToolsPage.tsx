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
import { useI18n } from "../i18n";
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
  LAUNCH_SUPPORT_KEY,
  LAUNCH_SUPPORT_TONE,
  STATUS_FILTER_VALUES,
  TOOL_STATUS_KEY,
  TOOL_TYPE_KEY,
  getStatusTone,
  getToolRowActions,
} from "../features/tools/data";
import { formatDateTime } from "../utils/format";
import type { LaunchSupport, ToolEntry, ToolStatus } from "../types/domain";
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

const LAUNCH_ICONS: Record<LaunchSupport, ReactNode> = {
  supported: <CheckCircle2 size={11} aria-hidden="true" />,
  needsConfiguration: <AlertTriangle size={11} aria-hidden="true" />,
  unsupported: <CircleSlash size={11} aria-hidden="true" />,
  unavailable: <CircleDashed size={11} aria-hidden="true" />,
};

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
    revalidateTool,
    setDefaultTool,
    removeTool,
    clearError,
  } = useTools();
  const { t } = useI18n();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [presetToolId, setPresetToolId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ToolEntry | null>(null);
  const [removing, setRemoving] = useState<ToolEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusFilters = useMemo(
    () =>
      STATUS_FILTER_VALUES.map((value) => ({
        value,
        label:
          value === "all"
            ? t("common.all")
            : t(TOOL_STATUS_KEY[value as ToolStatus]),
      })),
    [t],
  );

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
  const lastDetectionLabel = lastDetectionAt
    ? formatDateTime(lastDetectionAt)
    : null;

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
        title={t("tools.title")}
        description={t("tools.description")}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              onClick={() => void safely(() => detect())}
              disabled={!desktopAvailable || detecting}
            >
              {detecting ? t("common.detecting") : t("tools.redetect")}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={15} aria-hidden="true" />}
              onClick={() => openAddDialog(null)}
              disabled={!desktopAvailable}
            >
              {t("tools.add")}
            </Button>
          </>
        }
      />

      <Notice tone="info">
        {t("tools.notice")}
        {lastDetectionLabel &&
          t("tools.lastDetection", { time: lastDetectionLabel })}
      </Notice>

      {!desktopAvailable && (
        <Notice tone="warning" title={t("tools.unavailableTitle")}>
          {t("tools.unavailableBody")}
        </Notice>
      )}

      {error && (
        <Notice tone="danger" title={t("tools.errorTitle")}>
          {error}
          <button type="button" className={styles.linkButton} onClick={clearError}>
            {t("common.gotIt")}
          </button>
        </Notice>
      )}

      <div className={styles.toolbar}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("tools.searchPlaceholder")}
          label={t("tools.searchLabel")}
        />
        <SegmentedControl
          ariaLabel={t("tools.filterAria")}
          size="sm"
          options={statusFilters}
          value={filter}
          onChange={setFilter}
        />
        <span className={styles.count}>
          {t("tools.count", {
            filtered: filtered.length,
            total: tools.length,
            detected: detectedCount,
          })}
        </span>
      </div>

      <div className={styles.listWrap}>
        {loading ? (
          <p className={styles.loading}>{t("tools.loading")}</p>
        ) : tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title={t("tools.emptyTitle")}
            description={t("tools.emptyDescription")}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t("tools.noMatchTitle")}
            description={t("tools.noMatchDescription")}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                {t("common.clearFilter")}
              </Button>
            }
          />
        ) : (
          <ul className={styles.list}>
            {filtered.map((tool) => {
              return (
                <li key={tool.id} className={styles.row}>
                  <span className={styles.icon} aria-hidden="true">
                    <Wrench size={16} />
                  </span>

                  <div className={styles.main}>
                    <div className={styles.titleRow}>
                      <span className={styles.name}>{tool.name}</span>
                      {tool.isDefault && (
                        <Badge tone="accent">{t("tools.default")}</Badge>
                      )}
                      {tool.isCustom && (
                        <Badge tone="accent">{t("tools.custom")}</Badge>
                      )}
                      {tool.source === "auto" && (
                        <Badge tone="neutral">{t("tools.auto")}</Badge>
                      )}
                      {tool.source === "manual" && (
                        <Badge tone="neutral">{t("tools.manual")}</Badge>
                      )}
                      <span className={styles.type}>
                        {t(TOOL_TYPE_KEY[tool.toolType])}
                      </span>
                    </div>
                    <span className={styles.description}>
                      {tool.executablePath ?? tool.commandName ?? tool.description}
                    </span>
                    <span className={styles.meta}>
                      {tool.version && (
                        <>{t("tools.version", { version: tool.version })} · </>
                      )}
                      {tool.detectedAt && (
                        <>
                          {t("tools.detectedAt", {
                            time: formatDateTime(tool.detectedAt),
                          })}{" "}
                          ·{" "}
                        </>
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

                  <div className={styles.statusCell}>
                    <Badge
                      tone={getStatusTone(tool.status)}
                      icon={STATUS_ICONS[tool.status]}
                    >
                      {t(TOOL_STATUS_KEY[tool.status])}
                    </Badge>

                    {tool.installed && (
                      <span
                        className={styles.launchBadge}
                        title={tool.launch.reason}
                      >
                        <Badge
                          tone={LAUNCH_SUPPORT_TONE[tool.launch.support]}
                          icon={LAUNCH_ICONS[tool.launch.support]}
                        >
                          {t(LAUNCH_SUPPORT_KEY[tool.launch.support])}
                        </Badge>
                      </span>
                    )}
                  </div>

                  <div className={styles.actions}>
                    {getToolRowActions(tool).map((action) => {
                      switch (action) {
                        case "manualConfig":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              onClick={() => openAddDialog(tool.toolId)}
                              disabled={!desktopAvailable}
                            >
                              {t("tools.manualConfig")}
                            </Button>
                          );
                        case "detect":
                        case "redetect":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void safely(() => detect(tool.toolId))
                              }
                              disabled={!desktopAvailable || detecting}
                            >
                              {action === "detect"
                                ? t("tools.detect")
                                : t("tools.redetect")}
                            </Button>
                          );
                        case "revalidate":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void safely(() => revalidateTool(tool.id))
                              }
                              disabled={!desktopAvailable || detecting}
                            >
                              {t("tools.revalidate")}
                            </Button>
                          );
                        case "setDefault":
                        case "unsetDefault":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              icon={
                                action === "unsetDefault" ? (
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
                              {action === "unsetDefault"
                                ? t("tools.unsetDefault")
                                : t("tools.setDefault")}
                            </Button>
                          );
                        case "configure":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              icon={<Settings2 size={14} aria-hidden="true" />}
                              onClick={() => openEditDialog(tool)}
                              disabled={!desktopAvailable}
                            >
                              {t("tools.configure")}
                            </Button>
                          );
                        case "remove":
                          return (
                            <Button
                              key={action}
                              variant="ghost"
                              size="sm"
                              icon={<Trash2 size={14} aria-hidden="true" />}
                              onClick={() => setRemoving(tool)}
                              disabled={!desktopAvailable}
                            >
                              {t("tools.remove")}
                            </Button>
                          );
                        default:
                          return null;
                      }
                    })}
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
        title={t("tools.confirmRemoveTitle")}
        description={
          removing
            ? t("tools.confirmRemoveDescription", { name: removing.name })
            : ""
        }
        confirmLabel={t("common.remove")}
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
        <p className={styles.confirmNote}>{t("tools.confirmRemoveNote")}</p>
      </ConfirmDialog>
    </div>
  );
}
