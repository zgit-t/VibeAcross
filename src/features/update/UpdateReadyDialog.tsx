import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useUpdateController } from "./useUpdateController";
import styles from "./UpdateReadyDialog.module.css";

/**
 * 全局「更新已就绪」确认弹窗。
 *
 * 当更新下载完成（phase === "ready"）时出现，无论用户当前在哪个页面，
 * 都可以选择立即安装并重启，或稍后手动安装。
 */
export function UpdateReadyDialog() {
  const { t } = useI18n();
  const { state, ready, install, dismiss } = useUpdateController();

  return (
    <ConfirmDialog
      open={ready}
      title={t("update.readyTitle")}
      description={t("update.readyDescription", {
        version: state.version ?? "",
      })}
      confirmLabel={t("update.installNow")}
      cancelLabel={t("update.restartLater")}
      busy={state.phase === "installing"}
      onConfirm={install}
      onClose={dismiss}
    >
      {state.notes && (
        <div className={styles.notes}>
          <p className={styles.notesTitle}>{t("update.releaseNotes")}</p>
          <p className={styles.notesBody}>{state.notes}</p>
        </div>
      )}
    </ConfirmDialog>
  );
}
