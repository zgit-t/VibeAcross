import { useState } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { useApp } from "../../context/AppContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useI18n } from "../../i18n";
import { toErrorMessage } from "../../services/backend";
import { formatDateTime, formatRelativeTime } from "../../utils/format";
import type { ToolEntry, WorkspaceSession } from "../../types/domain";
import {
  getSessionState,
  RESTORE_STATUS_KEY,
  restorableTools,
  sessionName,
} from "./meta";
import styles from "./SessionList.module.css";

interface SessionListProps {
  sessions: WorkspaceSession[];
  /** 工具安装 id → 工具条目；用于展示名称与可恢复状态。 */
  toolById: Record<string, ToolEntry>;
  tools: ToolEntry[];
  /** 项目 id → 项目默认工具安装 id；记录未指定工具时用于回退判断。 */
  projectDefaultToolIdByProject: Record<string, string | null>;
  onEdit: (session: WorkspaceSession) => void;
}

/** 工作上下文列表：展示状态并支持恢复、切换工具、查看任务、编辑与删除。 */
export function SessionList({
  sessions,
  toolById,
  tools,
  projectDefaultToolIdByProject,
  onEdit,
}: SessionListProps) {
  const { restoreSession, deleteSession } = useWorkspace();
  const { openProject, openTask } = useApp();
  const { t } = useI18n();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toolChoice, setToolChoice] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<WorkspaceSession | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const options = restorableTools(tools);

  async function handleRestore(session: WorkspaceSession) {
    setPendingId(session.id);
    setError(null);
    try {
      const chosen = toolChoice[session.id];
      const toolId = (chosen ?? session.toolId ?? "") || null;
      await restoreSession(session.id, toolId);
    } catch (cause) {
      setError(toErrorMessage(cause, t("sessionList.restoreFailed")));
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) {
      return;
    }
    setPendingId(pendingDelete.id);
    setError(null);
    try {
      await deleteSession(pendingDelete.id);
      setPendingDelete(null);
    } catch (cause) {
      setError(toErrorMessage(cause, t("sessionList.deleteFailed")));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {sessions.map((session) => {
          const state = getSessionState(
            session,
            toolById,
            projectDefaultToolIdByProject[session.projectId] ?? null,
          );
          const busy = pendingId === session.id;
          const selectedTool = toolChoice[session.id] ?? session.toolId ?? "";

          return (
            <li key={session.id} className={styles.row}>
              <div className={styles.main}>
                <div className={styles.titleRow}>
                  <span className={styles.title}>{sessionName(session)}</span>
                  <Badge tone={state.tone}>{t(state.labelKey)}</Badge>
                </div>

                <div className={styles.meta}>
                  {session.projectName ? (
                    <button
                      type="button"
                      className={styles.projectLink}
                      onClick={() => openProject(session.projectId)}
                      title={t("sessionList.openProject", {
                        name: session.projectName,
                      })}
                    >
                      {session.projectName}
                    </button>
                  ) : (
                    <span className={styles.project}>
                      {t("sessionList.projectDeleted")}
                    </span>
                  )}
                  <span className={styles.dot} aria-hidden="true">
                    ·
                  </span>
                  <span className={styles.tool}>
                    {session.toolName ?? t("sessionList.noTool")}
                  </span>
                  {session.taskTitle && (
                    <>
                      <span className={styles.dot} aria-hidden="true">
                        ·
                      </span>
                      <button
                        type="button"
                        className={styles.taskLink}
                        onClick={() => {
                          if (session.taskId) {
                            openTask(session.taskId);
                          }
                        }}
                        disabled={!session.taskId}
                        title={t("sessionList.viewInTasks")}
                      >
                        {session.taskTitle}
                      </button>
                    </>
                  )}
                </div>

                <div className={styles.status}>
                  <span>
                    {t("sessionList.lastUsed", {
                      time: formatRelativeTime(session.lastUsedAt),
                    })}
                    <span className={styles.tooltip}>
                      （{formatDateTime(session.lastUsedAt)}）
                    </span>
                  </span>
                  {session.lastRestoreStatus && (
                    <span
                      className={
                        session.lastRestoreStatus === "failed"
                          ? styles.statusFailed
                          : styles.statusOk
                      }
                    >
                      {t(RESTORE_STATUS_KEY[session.lastRestoreStatus])}
                      {session.lastRestoreError
                        ? `：${session.lastRestoreError}`
                        : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.controls}>
                {options.length > 1 && (
                  <label className={styles.toolSelect}>
                    <span className={styles.toolSelectLabel}>
                      {t("sessionList.restoreWith")}
                    </span>
                    <select
                      value={selectedTool}
                      disabled={busy}
                      aria-label={t("sessionList.restoreWithAria")}
                      onChange={(event) =>
                        setToolChoice((prev) => ({
                          ...prev,
                          [session.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">{t("sessionList.byRecord")}</option>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Play size={14} aria-hidden="true" />}
                  disabled={busy || !state.canRestore}
                  onClick={() => void handleRestore(session)}
                  title={state.canRestore ? undefined : t(state.detailKey)}
                >
                  {busy ? t("sessionList.restoring") : t("sessionList.restore")}
                </Button>
              </div>

              <div className={styles.actions}>
                <IconButton
                  label={t("sessionList.edit")}
                  size="sm"
                  onClick={() => onEdit(session)}
                  disabled={busy}
                >
                  <Pencil size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={t("sessionList.delete")}
                  size="sm"
                  className={styles.dangerIcon}
                  onClick={() => setPendingDelete(session)}
                  disabled={busy}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("sessionList.confirmDeleteTitle")}
        description={
          pendingDelete
            ? t("sessionList.confirmDeleteDescription", {
                name: sessionName(pendingDelete),
              })
            : undefined
        }
        confirmLabel={t("common.delete")}
        tone="danger"
        busy={pendingId !== null}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
