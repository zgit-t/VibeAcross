import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { useTaskActions } from "../../context/TasksContext";
import { toErrorMessage } from "../../services/backend";
import type { Task, TaskPriority, TaskStatus } from "../../types/domain";
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from "./meta";
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

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    if (!title.trim()) {
      nextErrors.title = "请输入任务标题。";
    }
    if (!projectId) {
      nextErrors.project = "请选择所属项目。";
    }
    if (dueDate && Number.isNaN(new Date(dueDate).getTime())) {
      nextErrors.dueDate = "截止日期无效。";
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
        priority,
        dueDate: dueDate || null,
      };
      if (isEditing && task) {
        await updateTask(task.id, { ...payload, status });
      } else {
        await createTask(payload);
      }
      onClose();
    } catch (cause) {
      setSubmitError(toErrorMessage(cause, "保存任务失败。"));
    } finally {
      setBusy(false);
    }
  }

  const noProjects = projectOptions.length === 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={isEditing ? "编辑任务" : "新建任务"}
      description={
        isEditing ? "更新任务内容、状态与优先级。" : "创建一个新的开发任务。"
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="task-form"
            disabled={busy || noProjects}
          >
            {busy ? "保存中…" : isEditing ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      {noProjects ? (
        <Notice tone="warning" title="需要先创建项目">
          任务必须归属一个项目。请先在 Projects 页面创建或导入项目。
        </Notice>
      ) : (
        <form id="task-form" className={styles.form} onSubmit={handleSubmit}>
          {submitError && <Notice tone="danger">{submitError}</Notice>}

          <TextField
            label="任务标题"
            placeholder="例如：修复登录接口错误处理"
            value={title}
            required
            error={errors.title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <SelectField
            label="所属项目"
            value={projectId}
            options={projectOptions.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
            error={errors.project}
            onChange={(event) => setProjectId(event.target.value)}
          />

          <div className={styles.row}>
            <SelectField
              label="状态"
              value={status}
              options={TASK_STATUS_OPTIONS}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            />
            <SelectField
              label="优先级"
              value={priority}
              options={TASK_PRIORITY_OPTIONS}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
            />
          </div>

          <TextField
            label="截止日期"
            type="date"
            value={dueDate}
            error={errors.dueDate}
            hint="可选。留空表示不设置截止日期。"
            onChange={(event) => setDueDate(event.target.value)}
          />

          <label className={styles.textareaField}>
            <span className={styles.textareaLabel}>描述</span>
            <textarea
              className={styles.textarea}
              value={description}
              rows={3}
              placeholder="补充任务的背景或验收标准…"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
