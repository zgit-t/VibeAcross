import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { useTaskActions } from "../../context/TasksContext";
import { useI18n } from "../../i18n";
import { toErrorMessage } from "../../services/backend";
import { formatDateTime } from "../../utils/format";
import type { Task, TaskStatus } from "../../types/domain";
import {
  getDueState,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
} from "./meta";
import styles from "./TaskList.module.css";

interface TaskListProps {
  tasks: Task[];
  /** 项目 id → 名称；用于展示任务归属。 */
  projectNameById: Record<string, string>;
  onEdit: (task: Task) => void;
  /** 打开任务所属项目（提供后项目名变为可点击链接）。 */
  onOpenProject?: (projectId: string) => void;
  onChanged?: () => void;
}

const DUE_TONE_CLASS = {
  overdue: "dueOverdue",
  today: "dueToday",
  upcoming: "dueUpcoming",
  none: "",
} as const;

/** 任务列表：展示任务并支持三态切换、编辑与删除。 */
export function TaskList({
  tasks,
  projectNameById,
  onEdit,
  onOpenProject,
  onChanged,
}: TaskListProps) {
  const { setTaskStatus, deleteTask } = useTaskActions();
  const { t } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(task: Task, next: TaskStatus) {
    if (task.status === next) {
      return;
    }
    setPendingId(task.id);
    setError(null);
    try {
      await setTaskStatus(task.id, next);
      onChanged?.();
    } catch (cause) {
      setError(toErrorMessage(cause, t("taskList.statusFailed")));
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
      await deleteTask(pendingDelete.id);
      setPendingDelete(null);
      onChanged?.();
    } catch (cause) {
      setError(toErrorMessage(cause, t("taskList.deleteFailed")));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {tasks.map((task) => {
          const priorityMeta = TASK_PRIORITY_META[task.priority];
          const done = task.status === "done";
          const dueState = getDueState(task.dueDate, task.status);
          const projectName = projectNameById[task.projectId];
          const busy = pendingId === task.id;

          return (
            <li key={task.id} className={styles.row}>
              <div
                className={styles.statusGroup}
                role="group"
                aria-label={t("taskDialog.statusLabel")}
              >
                {TASK_STATUS_ORDER.map((status) => {
                  const meta = TASK_STATUS_META[status];
                  const StatusIcon = meta.icon;
                  const active = task.status === status;
                  const label = t(meta.labelKey);
                  return (
                    <button
                      key={status}
                      type="button"
                      className={`${styles.statusToggle} ${
                        active ? styles.statusActive : ""
                      } ${status === "done" ? styles.statusDone : ""}`}
                      aria-pressed={active}
                      title={label}
                      aria-label={label}
                      disabled={busy}
                      onClick={() => void changeStatus(task, status)}
                    >
                      <StatusIcon size={17} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>

              <div className={styles.main}>
                <span
                  className={`${styles.title} ${done ? styles.titleDone : ""}`}
                  title={task.title}
                >
                  {task.title}
                </span>
                <span className={styles.meta}>
                  {onOpenProject && projectName ? (
                    <button
                      type="button"
                      className={styles.projectLink}
                      onClick={() => onOpenProject(task.projectId)}
                      title={t("taskList.openProject", { name: projectName })}
                    >
                      {projectName}
                    </button>
                  ) : (
                    <span className={styles.project}>
                      {projectName ?? t("taskList.unknownProject")}
                    </span>
                  )}
                  {task.dueDate && (
                    <span
                      className={`${styles.due} ${
                        DUE_TONE_CLASS[dueState]
                          ? styles[DUE_TONE_CLASS[dueState]]
                          : ""
                      }`}
                    >
                      {t("taskList.due", { date: task.dueDate })}
                      {dueState === "overdue" ? t("taskList.overdue") : ""}
                    </span>
                  )}
                </span>
              </div>

              <div className={styles.badges}>
                <Badge tone={TASK_STATUS_META[task.status].tone}>
                  {t(TASK_STATUS_META[task.status].labelKey)}
                </Badge>
                <Badge tone={priorityMeta.tone}>
                  {t("taskList.priority", {
                    label: t(priorityMeta.labelKey),
                  })}
                </Badge>
              </div>

              <time
                className={styles.time}
                dateTime={task.updatedAt}
                title={t("taskList.updatedAt", {
                  time: formatDateTime(task.updatedAt),
                })}
              >
                {formatDateTime(task.updatedAt)}
              </time>

              <div className={styles.actions}>
                <IconButton
                  label={t("taskList.edit")}
                  size="sm"
                  onClick={() => onEdit(task)}
                  disabled={busy}
                >
                  <Pencil size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={t("taskList.delete")}
                  size="sm"
                  className={styles.dangerIcon}
                  onClick={() => setPendingDelete(task)}
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
        title={t("taskList.confirmDeleteTitle")}
        description={
          pendingDelete
            ? t("taskList.confirmDeleteDescription", {
                title: pendingDelete.title,
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
