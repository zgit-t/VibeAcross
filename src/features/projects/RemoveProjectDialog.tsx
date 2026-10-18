import { useEffect, useState } from "react";
import { useProjects } from "../../context/ProjectsContext";
import { useI18n } from "../../i18n";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Notice } from "../../components/ui/Notice";
import { RadioGroup } from "../../components/ui/RadioGroup";
import { toErrorMessage } from "../../services/backend";
import type { Project } from "../../types/domain";
import styles from "./RemoveProjectDialog.module.css";

/** 移除范围：仅移除记录，或同时删除磁盘文件夹。 */
type RemovalScope = "record" | "folder";

interface RemoveProjectDialogProps {
  /** 待移除的项目；为 null 时弹窗关闭。 */
  project: Project | null;
  onClose: () => void;
  /** 成功移除后回调（在 `onClose` 之前触发）。 */
  onRemoved?: (project: Project, deletedFolder: boolean) => void;
}

/**
 * 共享的项目移除弹窗，项目列表与项目详情共用，保证两个入口行为一致。
 *
 * 默认选中「仅从 VibeAcross 移除」，不会删除磁盘文件；选择「同时删除磁盘文件夹」时
 * 必须再经过一次明确确认（展示项目名与完整路径）才会执行，删除成功后才移除记录。
 */
export function RemoveProjectDialog({
  project,
  onClose,
  onRemoved,
}: RemoveProjectDialogProps) {
  const { remove } = useProjects();
  const { t } = useI18n();

  const [scope, setScope] = useState<RemovalScope>("record");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = project !== null;
  const projectId = project?.id ?? null;

  // 每次打开都重置为默认的「仅移除记录」，绝不默认删除磁盘文件。
  useEffect(() => {
    if (open) {
      setScope("record");
      setStep("choose");
      setBusy(false);
      setError(null);
    }
  }, [open, projectId]);

  async function perform(deleteFolder: boolean) {
    if (!project) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await remove(project.id, deleteFolder);
      onRemoved?.(project, deleteFolder);
      onClose();
    } catch (cause) {
      // 删除失败时保留记录与弹窗，展示真实错误以便重试。
      setError(toErrorMessage(cause, t("projects.removeFailed")));
    } finally {
      setBusy(false);
    }
  }

  function handleConfirm() {
    if (!project) {
      return;
    }
    if (scope === "folder" && step === "choose") {
      // 第一次确认仅切换到二次确认，此时尚未删除任何内容。
      setError(null);
      setStep("confirm");
      return;
    }
    void perform(scope === "folder");
  }

  const confirmingDelete = scope === "folder" && step === "confirm";

  return (
    <ConfirmDialog
      open={open}
      title={
        confirmingDelete
          ? t("removeProject.folderConfirmTitle")
          : t("removeProject.title")
      }
      description={
        confirmingDelete
          ? t("removeProject.folderConfirmDescription", {
              name: project?.name ?? "",
            })
          : t("removeProject.description")
      }
      confirmLabel={
        confirmingDelete
          ? t("removeProject.folderConfirmLabel")
          : t("common.remove")
      }
      tone="danger"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      {project && (
        <div className={styles.body}>
          {error && <Notice tone="danger">{error}</Notice>}

          {confirmingDelete ? (
            <>
              <p className={styles.warning}>
                {t("removeProject.folderWarning")}
              </p>
              <dl className={styles.details}>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>
                    {t("removeProject.nameLabel")}
                  </dt>
                  <dd className={styles.detailValue}>{project.name}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailLabel}>
                    {t("removeProject.pathLabel")}
                  </dt>
                  <dd className={styles.detailValue}>
                    <code className={styles.path} title={project.path}>
                      {project.path}
                    </code>
                  </dd>
                </div>
              </dl>
              <p className={styles.note}>
                {t("removeProject.folderConfirmHint")}
              </p>
            </>
          ) : (
            <RadioGroup<RemovalScope>
              name="remove-project-scope"
              ariaLabel={t("removeProject.scopeAria")}
              value={scope}
              onChange={setScope}
              options={[
                {
                  value: "record",
                  label: t("removeProject.optionRecord"),
                  description: t("removeProject.optionRecordDescription"),
                  note: t("removeProject.optionRecordNote"),
                },
                {
                  value: "folder",
                  label: t("removeProject.optionFolder"),
                  description: t("removeProject.optionFolderDescription"),
                  note: t("removeProject.optionFolderNote"),
                },
              ]}
            />
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}
