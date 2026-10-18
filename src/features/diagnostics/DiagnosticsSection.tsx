import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FolderOpen, RotateCw, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import {
  SettingsGroup,
  SettingsRow,
} from "../../components/layout/SettingsGroup";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Notice } from "../../components/ui/Notice";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { pickSaveFile } from "../../services/dialog";
import {
  clearDiagnostics,
  exportDiagnostics,
  getDiagnosticsContent,
  getDiagnosticsInfo,
  openDiagnosticsLocation,
  suggestedDiagnosticsFileName,
} from "../../services/diagnostics";
import {
  isBackendError,
  isDesktopRuntime,
  toErrorMessage,
} from "../../services/backend";
import type { DiagnosticsContent, DiagnosticsInfo } from "../../types/domain";
import styles from "./DiagnosticsSection.module.css";

/** 诊断日志导出扩展名（不含点）。 */
const LOG_EXTENSION = "log";

type Busy = "export" | "clear" | null;

interface NoticeState {
  tone: "success" | "danger" | "warning" | "info";
  title?: string;
  body: string;
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 诊断日志设置区块：查看、定位、清空与导出。
 *
 * 日志只记录 OpenCode 原生会话适配器的关键交互，便于复现创建失败时交给开发者分析；
 * 不含任何对话内容，也不会上传到任何服务器。
 */
export function DiagnosticsSection() {
  const { t } = useI18n();
  const desktop = isDesktopRuntime();

  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [content, setContent] = useState<DiagnosticsContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) {
      return;
    }
    try {
      setInfo(await getDiagnosticsInfo());
    } catch (cause) {
      setNotice({
        tone: "danger",
        title: t("diagnostics.failedTitle"),
        body: toErrorMessage(cause),
      });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadContent() {
    setContentLoading(true);
    try {
      setContent(await getDiagnosticsContent());
    } catch (cause) {
      setNotice({
        tone: "danger",
        title: t("diagnostics.viewFailedTitle"),
        body: toErrorMessage(cause),
      });
    } finally {
      setContentLoading(false);
    }
  }

  function handleView() {
    setViewerOpen(true);
    void loadContent();
  }

  async function handleOpenLocation() {
    setNotice(null);
    try {
      await openDiagnosticsLocation();
    } catch (cause) {
      setNotice({
        tone: "danger",
        title: t("diagnostics.openFailedTitle"),
        body: toErrorMessage(cause),
      });
    }
  }

  async function handleClear() {
    setConfirmClear(false);
    setBusy("clear");
    setNotice(null);
    try {
      await clearDiagnostics();
      setContent(null);
      setViewerOpen(false);
      await refresh();
      setNotice({
        tone: "success",
        title: t("diagnostics.clearedTitle"),
        body: t("diagnostics.clearedBody"),
      });
    } catch (cause) {
      setNotice({
        tone: "danger",
        title: t("diagnostics.clearFailedTitle"),
        body: toErrorMessage(cause),
      });
    } finally {
      setBusy(null);
    }
  }

  async function runExport(target: string, overwrite: boolean) {
    setBusy("export");
    setNotice(null);
    try {
      const saved = await exportDiagnostics(target, overwrite);
      setNotice({
        tone: "success",
        title: t("diagnostics.successTitle"),
        body: t("diagnostics.successBody", { name: fileNameOf(saved.path) }),
      });
    } catch (cause) {
      if (isBackendError(cause) && cause.code === "DIAGNOSTICS_TARGET_EXISTS") {
        setOverwriteTarget(target);
      } else {
        setNotice({
          tone: "danger",
          title: t("diagnostics.failedTitle"),
          body: toErrorMessage(cause),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    const suggested = await suggestedDiagnosticsFileName().catch(
      () => `VibeAcross-diagnostics.${LOG_EXTENSION}`,
    );
    const target = await pickSaveFile({
      defaultPath: suggested,
      extensions: [LOG_EXTENSION],
      filterName: t("dialog.diagnosticsFilter"),
      title: t("dialog.saveDiagnostics"),
    });
    if (!target) {
      return;
    }
    await runExport(target, false);
  }

  const hasLog = info?.exists ?? false;

  return (
    <SettingsGroup
      title={t("diagnostics.groupTitle")}
      description={t("diagnostics.groupDescription")}
    >
      <SettingsRow
        label={t("diagnostics.statusLabel")}
        description={t("diagnostics.statusDescription")}
      >
        <Badge tone="neutral">
          {hasLog
            ? t("diagnostics.statusPresent", {
                size: formatBytes(info?.sizeBytes ?? 0),
              })
            : t("diagnostics.statusEmpty")}
        </Badge>
      </SettingsRow>

      <SettingsRow
        label={t("diagnostics.pathLabel")}
        description={t("diagnostics.pathDescription")}
      >
        <code className={styles.pathValue}>
          {info?.path ?? t("common.reading")}
        </code>
      </SettingsRow>

      <SettingsRow
        label={t("diagnostics.actionsLabel")}
        description={t("diagnostics.actionsDescription")}
      >
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye size={14} aria-hidden="true" />}
          onClick={handleView}
          disabled={!desktop}
        >
          {t("diagnostics.viewAction")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FolderOpen size={14} aria-hidden="true" />}
          onClick={() => void handleOpenLocation()}
          disabled={!desktop || !hasLog}
        >
          {t("diagnostics.openAction")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} aria-hidden="true" />}
          onClick={() => void handleExport()}
          disabled={!desktop || busy !== null || !hasLog}
        >
          {busy === "export"
            ? t("diagnostics.exporting")
            : t("diagnostics.exportAction")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={14} aria-hidden="true" />}
          onClick={() => setConfirmClear(true)}
          disabled={!desktop || busy !== null || !hasLog}
        >
          {t("diagnostics.clearAction")}
        </Button>
      </SettingsRow>

      <Notice tone="info" title={t("diagnostics.noteTitle")}>
        <span className={styles.note}>
          {t("diagnostics.note")}
        </span>
      </Notice>

      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      )}

      <Modal
        open={viewerOpen}
        title={t("diagnostics.viewerTitle")}
        description={t("diagnostics.viewerDescription")}
        size="lg"
        onClose={() => setViewerOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCw size={14} aria-hidden="true" />}
              onClick={() => void loadContent()}
              disabled={contentLoading}
            >
              {t("diagnostics.refreshAction")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setViewerOpen(false)}
            >
              {t("common.close")}
            </Button>
          </>
        }
      >
        {contentLoading ? (
          <p className={styles.viewerHint}>{t("diagnostics.viewerLoading")}</p>
        ) : content?.content ? (
          <>
            {content.truncated && (
              <Notice tone="warning">{t("diagnostics.viewerTruncated")}</Notice>
            )}
            <pre className={styles.logView}>{content.content}</pre>
          </>
        ) : (
          <p className={styles.viewerHint}>{t("diagnostics.viewerEmpty")}</p>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        title={t("diagnostics.clearConfirmTitle")}
        description={t("diagnostics.clearConfirmBody")}
        confirmLabel={t("diagnostics.clearConfirmAction")}
        tone="danger"
        busy={busy === "clear"}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void handleClear()}
      />

      <ConfirmDialog
        open={overwriteTarget !== null}
        title={t("diagnostics.overwriteTitle")}
        description={
          overwriteTarget
            ? t("diagnostics.overwriteBody", {
                name: fileNameOf(overwriteTarget),
              })
            : ""
        }
        confirmLabel={t("diagnostics.overwriteConfirm")}
        tone="danger"
        busy={busy === "export"}
        onClose={() => setOverwriteTarget(null)}
        onConfirm={() => {
          const target = overwriteTarget;
          setOverwriteTarget(null);
          if (target) {
            void runExport(target, true);
          }
        }}
      />
    </SettingsGroup>
  );
}
