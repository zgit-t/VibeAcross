import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { useTaskList } from "../../context/TasksContext";
import { useTools } from "../../context/ToolsContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useI18n } from "../../i18n";
import { toErrorMessage } from "../../services/backend";
import type { WorkspaceSession } from "../../types/domain";
import { restorableTools } from "./meta";
import styles from "./SessionDialog.module.css";

export interface ProjectOption {
  id: string;
  name: string;
}

interface SessionDialogProps {
  open: boolean;
  onClose: () => void;
  /** 编辑时传入现有记录；创建时为 null。 */
  session: WorkspaceSession | null;
  /** 预设项目（例如从项目详情入口创建时）。 */
  defaultProjectId?: string | null;
  projectOptions: ProjectOption[];
}

interface FormErrors {
  project?: string;
  label?: string;
}

/** 新建 / 编辑工作上下文表单弹窗。数据由后端校验并持久化。 */
export function SessionDialog({
  open,
  onClose,
  session,
  defaultProjectId,
  projectOptions,
}: SessionDialogProps) {
  const { createSession, updateSession } = useWorkspace();
  const { tools } = useTools();
  const { t } = useI18n();

  const [projectId, setProjectId] = useState("");
  const [toolId, setToolId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [label, setLabel] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isEditing = session !== null;

  // 每次打开时初始化表单。
  useEffect(() => {
    if (!open) {
      return;
    }
    setProjectId(
      session?.projectId ?? defaultProjectId ?? projectOptions[0]?.id ?? "",
    );
    setToolId(session?.toolId ?? "");
    setTaskId(session?.taskId ?? "");
    setLabel(session?.label ?? "");
    setErrors({});
    setSubmitError(null);
    setBusy(false);
    // 仅在打开态切换或记录变化时重新初始化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, defaultProjectId]);

  // 只加载所选项目的任务，供关联选择。
  const { tasks } = useTaskList(
    useMemo(() => ({ projectId: projectId || null }), [projectId]),
  );
  const toolOptions = useMemo(
    () => restorableTools(tools),
    [tools],
  );

  // 所选项目变化后，清空不再属于该项目的任务选择。
  useEffect(() => {
    if (taskId && !tasks.some((task) => task.id === taskId)) {
      setTaskId("");
    }
  }, [tasks, taskId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    if (!projectId) {
      nextErrors.project = t("sessionDialog.errProject");
    }
    if (label.trim().length > 120) {
      nextErrors.label = t("sessionDialog.errLabel");
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
        toolId: toolId || null,
        taskId: taskId || null,
        label: label.trim() ? label.trim() : null,
      };
      if (isEditing && session) {
        await updateSession(session.id, payload);
      } else {
        await createSession(payload);
      }
      onClose();
    } catch (cause) {
      setSubmitError(toErrorMessage(cause, t("sessionDialog.failed")));
    } finally {
      setBusy(false);
    }
  }

  const noProjects = projectOptions.length === 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={
        isEditing
          ? t("sessionDialog.titleEdit")
          : t("sessionDialog.titleCreate")
      }
      description={
        isEditing
          ? t("sessionDialog.descriptionEdit")
          : t("sessionDialog.descriptionCreate")
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
            form="session-form"
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
        <Notice tone="warning" title={t("sessionDialog.needProjectTitle")}>
          {t("sessionDialog.needProjectBody")}
        </Notice>
      ) : (
        <form id="session-form" className={styles.form} onSubmit={handleSubmit}>
          {submitError && <Notice tone="danger">{submitError}</Notice>}

          <SelectField
            label={t("sessionDialog.projectLabel")}
            value={projectId}
            disabled={isEditing}
            options={projectOptions.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            error={errors.project}
            onChange={(event) => setProjectId(event.target.value)}
          />

          <SelectField
            label={t("sessionDialog.toolLabel")}
            value={toolId}
            options={[
              { value: "", label: t("sessionDialog.toolNone") },
              ...toolOptions.map((tool) => ({
                value: tool.id,
                label: tool.name,
              })),
            ]}
            hint={t("sessionDialog.toolHint")}
            onChange={(event) => setToolId(event.target.value)}
          />

          <SelectField
            label={t("sessionDialog.taskLabel")}
            value={taskId}
            options={[
              { value: "", label: t("sessionDialog.taskNone") },
              ...tasks.map((task) => ({
                value: task.id,
                label: task.title,
              })),
            ]}
            hint={t("sessionDialog.taskHint")}
            onChange={(event) => setTaskId(event.target.value)}
          />

          <TextField
            label={t("sessionDialog.nameLabel")}
            placeholder={t("sessionDialog.namePlaceholder")}
            value={label}
            error={errors.label}
            hint={t("sessionDialog.nameHint")}
            onChange={(event) => setLabel(event.target.value)}
          />
        </form>
      )}
    </Modal>
  );
}
