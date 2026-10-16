import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { useTaskActions } from "../../context/TasksContext";
import { toErrorMessage } from "../../services/backend";
import { formatDateTime } from "../../utils/format";
import type { Task } from "../../types/domain";
import { getDueState, TASK_PRIORITY_META, TASK_STATUS_META } from "./meta";
import styles from "./TaskList.module.css";

interface TaskListProps {
  tasks: Task[];
  /** 项目 id → 名称；用于展示任务归属。 */
  projectNameById: Record<string, string>;
  onEdit: (task: Task) => void;
  onChanged?: () => void;
}

const DUE_TONE_CLASS = {
  overdue: "dueOverdue",
  today: "dueToday",
  upcoming: "dueUpcoming",
  none: "",
} as const;

/** 任务列表：展示任务并支持完成/重开、编辑与删除。 */
export function TaskList({
  tasks,
  projectNameById,
  onEdit,
  onChanged,
}: TaskListProps) {
  const { setTaskStatus, deleteTask } = useTaskActions();
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleStatus(task: Task) {
    setPendingId(task.id);
    setError(null);
    try {
      await setTaskStatus(task.id, task.status === "done" ? "todo" : "done");
      onChanged?.();
    } catch (cause) {
      setError(toErrorMessage(cause, "更新任务状态失败。"));
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
      setError(toErrorMessage(cause, "删除任务失败。"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.list}>
        {tasks.map((task) => {
          const statusMeta = TASK_STATUS_META[task.status];
          const priorityMeta = TASK_PRIORITY_META[task.priority];
          const StatusIcon = statusMeta.icon;
          const done = task.status === "done";
          const dueState = getDueState(task.dueDate, task.status);
          const projectName = projectNameById[task.projectId];
          const busy = pendingId === task.id;

          return (
            <li key={task.id} className={styles.row}>
              <button
                type="button"
                className={`${styles.statusToggle} ${
                  done ? styles.statusDone : ""
                }`}
                onClick={() => void toggleStatus(task)}
                disabled={busy}
                aria-pressed={done}
                title={done ? "重新打开任务" : "标记为已完成"}
                aria-label={done ? "重新打开任务" : "标记为已完成"}
              >
                <StatusIcon size={18} aria-hidden="true" />
              </button>

              <div className={styles.main}>
                <span className={`${styles.title} ${done ? styles.titleDone : ""}`}>
                  {task.title}
                </span>
                <span className={styles.meta}>
                  <span className={styles.project}>
                    {projectName ?? "未知项目"}
                  </span>
                  {task.dueDate && (
                    <span
                      className={`${styles.due} ${
                        DUE_TONE_CLASS[dueState]
                          ? styles[DUE_TONE_CLASS[dueState]]
                          : ""
                      }`}
                    >
                      截止 {task.dueDate}
                      {dueState === "overdue" ? "（已过期）" : ""}
                    </span>
                  )}
                </span>
              </div>

              <div className={styles.badges}>
                <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                <Badge tone={priorityMeta.tone}>优先级 {priorityMeta.label}</Badge>
              </div>

              <time
                className={styles.time}
                dateTime={task.updatedAt}
                title={`更新时间：${formatDateTime(task.updatedAt)}`}
              >
                {formatDateTime(task.updatedAt)}
              </time>

              <div className={styles.actions}>
                <IconButton
                  label="编辑任务"
                  size="sm"
                  onClick={() => onEdit(task)}
                  disabled={busy}
                >
                  <Pencil size={14} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="删除任务"
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
        title="删除任务？"
        description={
          pendingDelete
            ? `将永久删除「${pendingDelete.title}」，此操作无法撤销。`
            : undefined
        }
        confirmLabel="删除"
        tone="danger"
        busy={pendingId !== null}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
