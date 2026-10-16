import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ExternalLink, FolderKanban, RotateCcw } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useTaskActions } from "../../context/TasksContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useI18n } from "../../i18n";
import { toErrorMessage, isDesktopRuntime } from "../../services/backend";
import {
  PATH_STATUS_KEY,
  PATH_STATUS_TONE,
  TOOL_HEALTH_KEY,
  TOOL_HEALTH_TONE,
} from "../projects/health";
import { sessionName } from "../workspace/meta";
import type { ProjectHealth, Task, TaskPriority, TaskStatus } from "../../types/domain";
import { taskPriorityOptions, taskStatusOptions } from "./meta";
import styles from "./TaskDialog.module.css";

export interface ProjectOption {
  id: string;
  name: string;
}

interface TaskDialogProps {
  open: boolean;
  onClose: () => void;
  /** 编辑时传入现有任务；创建时为 null。 */
  task: Task | null;
  /** 预设项目（例如从项目详情页创建任务时）。 */
  defaultProjectId?: string | null;
  projectOptions: ProjectOption[];
}

interface FormErrors {
  title?: string;
  project?: string;
  dueDate?: string;
}

/** 新建 / 编辑任务表单弹窗。数据由后端校验并持久化。 */
export function TaskDialog({
  open,
  onClose,
  task,
  defaultProjectId,
  projectOptions,
}: TaskDialogProps) {
  const { createTask, updateTask } = useTaskActions();
  const { openProject, openSession, navigate } = useApp();
  const { projects, checkHealth } = useProjects();
  const { sessions } = useWorkspace();
  const { t } = useI18n();
  const desktopAvailable = isDesktopRuntime();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<ProjectHealth | null>(null);

  // 每次打开时根据传入的任务初始化表单。
  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(task?.title ?? "");
    setProjectId(
      task?.projectId ?? defaultProjectId ?? projectOptions[0]?.id ?? "",
    );
    setStatus(task?.status ?? "todo");
    setPriority(task?.priority ?? "medium");
    setDueDate(task?.dueDate ?? "");
    setDescription(task?.description ?? "");
    setErrors({});
    setSubmitError(null);
    setBusy(false);
    // projectOptions 的引用在项目变化时更新；此处仅在打开态切换时初始化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaultProjectId]);

  const isEditing = task !== null;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );
  const projectSessions = useMemo(
    () => sessions.filter((session) => session.projectId === projectId),
    [sessions, projectId],
  );

  // 编辑已有任务时按需只读检查所属项目的路径 / 默认工具状态。
  useEffect(() => {
    setHealth(null);
    if (!open || !desktopAvailable || !projectId) {
      return;
    }
    let cancelled = false;
    checkHealth(projectId, false)
      .then((result) => {
        if (!cancelled) {
          setHealth(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // checkHealth 引用随上下文更新，无需作为依赖；仅在打开或项目变化时重新检查。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, desktopAvailable]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    if (!title.trim()) {
      nextErrors.title = t("taskDialog.errTitle");
    }
    if (!projectId) {
      nextErrors.project = t("taskDialog.errProject");
    }
    if (dueDate && Number.isNaN(new Date(dueDate).getTime())) {
      nextErrors.dueDate = t("taskDialog.errDue");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    setSubmitError(null);
    try {
      const payload = {
        projectId,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        status,
        priority,
        dueDate: dueDate || null,
      };
      if (isEditing && task) {
        await updateTask(task.id, payload);
      } else {
        await createTask(payload);
      }
      onClose();
    } catch (cause) {
      setSubmitError(toErrorMessage(cause, t("taskDialog.failed")));
    } finally {
      setBusy(false);
    }
  }

  const noProjects = projectOptions.length === 0;

  function handleOpenProject() {
    onClose();
    openProject(projectId);
  }

  function handleOpenSession(sessionId: string) {
    onClose();
    openSession(sessionId);
  }

  function handleGoSessions() {
    onClose();
    navigate("sessions");
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={isEditing ? t("taskDialog.titleEdit") : t("taskDialog.titleCreate")}
      description={
        isEditing
          ? t("taskDialog.descriptionEdit")
          : t("taskDialog.descriptionCreate")
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="task-form"
            disabled={busy || noProjects}
          >
            {busy
              ? t("common.saving")
              : isEditing
                ? t("common.save")
                : t("common.create")}
          </Button>
        </>
      }
    >
      {noProjects ? (
        <Notice tone="warning" title={t("taskDialog.needProjectTitle")}>
          {t("taskDialog.needProjectBody")}
        </Notice>
      ) : (
        <form id="task-form" className={styles.form} onSubmit={handleSubmit}>
          {submitError && <Notice tone="danger">{submitError}</Notice>}

          <TextField
            label={t("taskDialog.titleLabel")}
            placeholder={t("taskDialog.titlePlaceholder")}
            value={title}
            required
            error={errors.title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <SelectField
            label={t("taskDialog.projectLabel")}
            value={projectId}
            options={projectOptions.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            error={errors.project}
            onChange={(event) => setProjectId(event.target.value)}
          />

          {isEditing && selectedProject && (
            <section
              className={styles.context}
              aria-label={t("taskDialog.contextTitle")}
            >
              <div className={styles.contextHeader}>
                <span className={styles.contextTitle}>
                  <FolderKanban size={14} aria-hidden="true" />
                  {t("taskDialog.contextTitle")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink size={14} aria-hidden="true" />}
                  onClick={handleOpenProject}
                >
                  {t("taskDialog.openProject")}
                </Button>
              </div>

              <div className={styles.contextRow}>
                <span className={styles.contextLabel}>
                  {t("health.pathLabel")}
                </span>
                <span className={styles.contextValue} title={selectedProject.path}>
                  {selectedProject.path}
                </span>
                {health && health.pathStatus !== "ok" && (
                  <Badge tone={PATH_STATUS_TONE[health.pathStatus]}>
                    {t(PATH_STATUS_KEY[health.pathStatus])}
                  </Badge>
                )}
              </div>

              <div className={styles.contextRow}>
                <span className={styles.contextLabel}>
                  {t("health.toolLabel")}
                </span>
                {health ? (
                  <Badge tone={TOOL_HEALTH_TONE[health.toolStatus]}>
                    {t(TOOL_HEALTH_KEY[health.toolStatus])}
                  </Badge>
                ) : (
                  <span className={styles.contextMuted}>
                    {desktopAvailable
                      ? t("common.loading")
                      : t("taskDialog.contextUnavailable")}
                  </span>
                )}
              </div>

              <div className={styles.contextRow}>
                <span className={styles.contextLabel}>
                  {t("taskDialog.contextsLabel")}
                </span>
                {projectSessions.length > 0 ? (
                  <div className={styles.contextLinks}>
                    {projectSessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className={styles.contextLink}
                        onClick={() => handleOpenSession(session.id)}
                      >
                        {sessionName(session)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={styles.contextMuted}>
                    {t("taskDialog.noContexts")}
                  </span>
                )}
              </div>

              {projectSessions.length === 0 && (
                <div className={styles.contextActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw size={14} aria-hidden="true" />}
                    onClick={handleGoSessions}
                  >
                    {t("taskDialog.createContext")}
                  </Button>
                </div>
              )}
            </section>
          )}

          <div className={styles.row}>
            <SelectField
              label={t("taskDialog.statusLabel")}
              value={status}
              options={taskStatusOptions(t)}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            />
            <SelectField
              label={t("taskDialog.priorityLabel")}
              value={priority}
              options={taskPriorityOptions(t)}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
            />
          </div>

          <TextField
            label={t("taskDialog.dueLabel")}
            type="date"
            value={dueDate}
            error={errors.dueDate}
            hint={t("taskDialog.dueHint")}
            onChange={(event) => setDueDate(event.target.value)}
          />

          <label className={styles.textareaField}>
            <span className={styles.textareaLabel}>
              {t("taskDialog.descriptionLabel")}
            </span>
            <textarea
              className={styles.textarea}
              value={description}
              rows={3}
              placeholder={t("taskDialog.descriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
