import { useMemo, useState } from "react";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import { useI18n } from "../../i18n";
import { SettingsGroup, SettingsRow } from "../../components/layout/SettingsGroup";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { pickFile, pickSaveFile } from "../../services/dialog";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  suggestedBackupFileName,
} from "../../services/backup";
import {
  isBackendError,
  isDesktopRuntime,
  toErrorMessage,
} from "../../services/backend";
import { formatDateTime } from "../../utils/format";
import type { BackupCounts, BackupInfo } from "../../types/domain";
import styles from "./BackupSection.module.css";

/** 备份文件扩展名（不含点），与后端保持一致。 */
const BACKUP_EXTENSION = "vibeacross-backup";

/** 恢复完成后用于在重新加载界面后展示成功提示的会话键。 */
const RESTORE_NOTICE_KEY = "vibeacross.restoreNotice";

type Busy = "backup" | "restore" | null;

interface NoticeState {
  tone: "success" | "danger" | "warning" | "info";
  title?: string;
  body: string;
}

function totalRecords(counts: BackupCounts): number {
  return (
    counts.projects +
    counts.tasks +
    counts.toolInstallations +
    counts.workspaceSessions +
    counts.settings
  );
}

/** 数据备份与恢复设置区块：真实创建一致性备份，并从备份受控恢复。 */
export function BackupSection() {
  const { t } = useI18n();
  const desktop = isDesktopRuntime();

  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<NoticeState | null>(() => {
    const pending = sessionStorage.getItem(RESTORE_NOTICE_KEY);
    if (pending) {
      sessionStorage.removeItem(RESTORE_NOTICE_KEY);
      return {
        tone: "success",
        title: t("backup.restoreSuccessTitle"),
        body: t("backup.restoreSuccessBody", { name: pending }),
      };
    }
    return null;
  });
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupInfo | null>(
    null,
  );

  const countsLabel = useMemo(() => {
    if (!restoreCandidate) {
      return "";
    }
    const { counts } = restoreCandidate;
    return [
      t("backup.countProjects", { count: counts.projects }),
      t("backup.countTasks", { count: counts.tasks }),
      t("backup.countTools", { count: counts.toolInstallations }),
      t("backup.countSessions", { count: counts.workspaceSessions }),
      t("backup.countSettings", { count: counts.settings }),
    ].join(" · ");
  }, [restoreCandidate, t]);

  async function runBackup(target: string, overwrite: boolean) {
    setBusy("backup");
    setNotice(null);
    try {
      const info = await createBackup(target, overwrite);
      setNotice({
        tone: "success",
        title: t("backup.successTitle"),
        body: t("backup.successBody", {
          name: info.fileName,
          count: totalRecords(info.counts),
        }),
      });
    } catch (cause) {
      if (isBackendError(cause) && cause.code === "BACKUP_TARGET_EXISTS") {
        setOverwriteTarget(target);
      } else {
        setNotice({
          tone: "danger",
          title: t("backup.failedTitle"),
          body: toErrorMessage(cause),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleBackup() {
    const suggested = await suggestedBackupFileName().catch(
      () => `VibeAcross.${BACKUP_EXTENSION}`,
    );
    const target = await pickSaveFile({
      defaultPath: suggested,
      extensions: [BACKUP_EXTENSION],
      title: t("dialog.saveBackup"),
    });
    if (!target) {
      return;
    }
    await runBackup(target, false);
  }

  async function handlePickRestore() {
    const source = await pickFile({
      extensions: [BACKUP_EXTENSION],
      title: t("dialog.pickBackup"),
    });
    if (!source) {
      return;
    }
    setBusy("restore");
    setNotice(null);
    try {
      const info = await inspectBackup(source);
      setRestoreCandidate(info);
    } catch (cause) {
      setNotice({
        tone: "danger",
        title: t("backup.restoreInvalidTitle"),
        body: toErrorMessage(cause),
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRestore() {
    if (!restoreCandidate) {
      return;
    }
    setBusy("restore");
    try {
      await restoreBackup(restoreCandidate.path);
      // 恢复成功后所有数据都已变化；记录提示并重新加载界面以刷新全部视图。
      sessionStorage.setItem(RESTORE_NOTICE_KEY, restoreCandidate.fileName);
      window.location.reload();
    } catch (cause) {
      setRestoreCandidate(null);
      setNotice({
        tone: "danger",
        title: t("backup.restoreFailedTitle"),
        body: toErrorMessage(cause),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup
      title={t("backup.groupTitle")}
      description={t("backup.groupDescription")}
    >
      <SettingsRow
        label={t("backup.backupLabel")}
        description={t("backup.backupDescription")}
      >
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} aria-hidden="true" />}
          onClick={() => void handleBackup()}
          disabled={!desktop || busy !== null}
        >
          {busy === "backup" ? t("backup.saving") : t("backup.backupAction")}
        </Button>
      </SettingsRow>

      <SettingsRow
        label={t("backup.restoreLabel")}
        description={t("backup.restoreDescription")}
      >
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={14} aria-hidden="true" />}
          onClick={() => void handlePickRestore()}
          disabled={!desktop || busy !== null}
        >
          {busy === "restore" ? t("backup.reading") : t("backup.restoreAction")}
        </Button>
      </SettingsRow>

      <Notice tone="info" title={t("backup.noSourceCodeTitle")}>
        <span className={styles.note}>
          <DatabaseBackup size={14} aria-hidden="true" />
          {t("backup.noSourceCodeNote")}
        </span>
      </Notice>

      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      )}

      <ConfirmDialog
        open={overwriteTarget !== null}
        title={t("backup.overwriteTitle")}
        description={
          overwriteTarget
            ? t("backup.overwriteBody", {
                name:
                  overwriteTarget.split(/[\\/]/).pop() ?? overwriteTarget,
              })
            : ""
        }
        confirmLabel={t("backup.overwriteConfirm")}
        tone="danger"
        busy={busy === "backup"}
        onClose={() => setOverwriteTarget(null)}
        onConfirm={() => {
          const target = overwriteTarget;
          setOverwriteTarget(null);
          if (target) {
            void runBackup(target, true);
          }
        }}
      />

      <ConfirmDialog
        open={restoreCandidate !== null}
        title={t("backup.restoreConfirmTitle")}
        description={
          restoreCandidate
            ? t("backup.restoreConfirmDescription", {
                name: restoreCandidate.fileName,
              })
            : ""
        }
        confirmLabel={t("backup.restoreConfirmAction")}
        tone="danger"
        busy={busy === "restore"}
        onClose={() => setRestoreCandidate(null)}
        onConfirm={() => void confirmRestore()}
      >
        {restoreCandidate && (
          <div className={styles.details}>
            <p className={styles.detailRow}>
              <span className={styles.detailLabel}>
                {t("backup.createdLabel")}
              </span>
              <span>{formatDateTime(restoreCandidate.createdAt)}</span>
            </p>
            <p className={styles.detailRow}>
              <span className={styles.detailLabel}>
                {t("backup.versionLabel")}
              </span>
              <span>{restoreCandidate.schemaVersion}</span>
            </p>
            <p className={styles.detailRow}>
              <span className={styles.detailLabel}>
                {t("backup.countsLabel")}
              </span>
              <span>{countsLabel}</span>
            </p>
            <ul className={styles.warnings}>
              <li>{t("backup.restoreWarning")}</li>
              <li>{t("backup.restoreProtectiveNote")}</li>
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </SettingsGroup>
  );
}
