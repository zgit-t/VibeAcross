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
      nextErrors.project = "请选择关联项目。";
    }
    if (label.trim().length > 120) {
      nextErrors.label = "名称请控制在 120 个字符以内。";
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
      setSubmitError(toErrorMessage(cause, "保存工作上下文失败。"));
    } finally {
      setBusy(false);
    }
  }

  const noProjects = projectOptions.length === 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={isEditing ? "编辑工作上下文" : "保存工作上下文"}
      description={
        isEditing
          ? "更新关联的工具、任务与名称。项目不可更改。"
          : "保存当前「项目 + 工具 + 任务」组合，便于之后一键恢复。"
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
            form="session-form"
            disabled={busy || noProjects}
          >
            {busy ? "保存中…" : isEditing ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      {noProjects ? (
        <Notice tone="warning" title="需要先创建项目">
          工作上下文必须关联一个项目。请先在 Projects 页面创建或导入项目。
        </Notice>
      ) : (
        <form id="session-form" className={styles.form} onSubmit={handleSubmit}>
          {submitError && <Notice tone="danger">{submitError}</Notice>}

          <SelectField
            label="关联项目"
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
            label="开发工具"
            value={toolId}
            options={[
              { value: "", label: "未指定（恢复时选择）" },
              ...toolOptions.map((tool) => ({
                value: tool.id,
                label: tool.name,
              })),
            ]}
            hint="仅列出具备受控启动能力的工具。"
            onChange={(event) => setToolId(event.target.value)}
          />

          <SelectField
            label="关联任务"
            value={taskId}
            options={[
              { value: "", label: "不关联任务" },
              ...tasks.map((task) => ({
                value: task.id,
                label: task.title,
              })),
            ]}
            hint="可选。任务被删除后工作上下文仍可继续使用。"
            onChange={(event) => setTaskId(event.target.value)}
          />

          <TextField
            label="名称"
            placeholder="例如：登录功能开发"
            value={label}
            error={errors.label}
            hint="可选。用于在列表中区分多条上下文。"
            onChange={(event) => setLabel(event.target.value)}
          />
        </form>
      )}
    </Modal>
  );
}
