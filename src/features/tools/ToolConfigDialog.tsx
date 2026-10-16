import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import { useTools } from "../../context/ToolsContext";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { pickFile } from "../../services/dialog";
import { resolveToolCommand } from "../../services/tools";
import { toErrorMessage } from "../../services/backend";
import { TOOL_TYPE_LABEL } from "./data";
import type { ToolEntry, ToolType } from "../../types/domain";
import styles from "./ToolConfigDialog.module.css";

const CUSTOM_VALUE = "__custom__";

const TYPE_OPTIONS: Array<{ value: ToolType; label: string }> = [
  { value: "desktop", label: TOOL_TYPE_LABEL.desktop },
  { value: "cli", label: TOOL_TYPE_LABEL.cli },
];

interface ToolConfigDialogProps {
  open: boolean;
  onClose: () => void;
  /** 编辑已有条目时提供。 */
  entry?: ToolEntry | null;
  /** 新增时预选的工具 id。 */
  presetToolId?: string | null;
}

interface FormErrors {
  name?: string;
  config?: string;
}

/** 新增或编辑一条工具配置。写入 SQLite 并触发一次即时校验。 */
export function ToolConfigDialog({
  open,
  onClose,
  entry = null,
  presetToolId = null,
}: ToolConfigDialogProps) {
  const { tools, addTool, updateTool } = useTools();
  const isEdit = entry !== null;

  const [selectedToolId, setSelectedToolId] = useState<string>(CUSTOM_VALUE);
  const [name, setName] = useState("");
  const [toolType, setToolType] = useState<ToolType>("desktop");
  const [executablePath, setExecutablePath] = useState("");
  const [commandName, setCommandName] = useState("");
  const [commandPreview, setCommandPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 内置工具选项：按目录顺序去重（内置占位条目 + 已配置条目）。
  const builtInOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const tool of tools) {
      if (tool.isCustom || seen.has(tool.toolId)) {
        continue;
      }
      seen.add(tool.toolId);
      options.push({ value: tool.toolId, label: tool.name });
    }
    return options;
  }, [tools]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrors({});
    setErrorMessage(null);
    setCommandPreview(null);
    setBusy(false);

    if (entry) {
      setSelectedToolId(entry.isCustom ? CUSTOM_VALUE : entry.toolId);
      setName(entry.name);
      setToolType(entry.toolType);
      setExecutablePath(entry.executablePath ?? "");
      setCommandName(entry.commandName ?? "");
    } else {
      setSelectedToolId(presetToolId ?? CUSTOM_VALUE);
      setName("");
      setToolType("desktop");
      setExecutablePath("");
      setCommandName("");
    }
  }, [open, entry, presetToolId]);

  const isCustom = !isEdit && selectedToolId === CUSTOM_VALUE;
  const presetDefinition = builtInOptions.find(
    (option) => option.value === selectedToolId,
  );
  const effectiveType: ToolType = isEdit
    ? entry!.toolType
    : isCustom
      ? toolType
      : tools.find((tool) => tool.toolId === selectedToolId)?.toolType ?? "desktop";

  function reset() {
    setErrors({});
    setErrorMessage(null);
    setBusy(false);
  }

  function handleClose() {
    if (busy) {
      return;
    }
    reset();
    onClose();
  }

  async function browseForExecutable() {
    const selected = await pickFile({
      defaultPath: executablePath || null,
      extensions:
        effectiveType === "cli"
          ? ["exe", "cmd", "bat", "com"]
          : ["exe", "com"],
    });
    if (selected) {
      setExecutablePath(selected);
      setErrors((prev) => ({ ...prev, config: undefined }));
    }
  }

  async function checkCommand() {
    const value = commandName.trim();
    if (!value) {
      setCommandPreview(null);
      return;
    }
    try {
      const resolved = await resolveToolCommand(value);
      setCommandPreview(resolved ?? "");
    } catch {
      setCommandPreview(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};

    if (isCustom && !name.trim()) {
      nextErrors.name = "请填写工具名称。";
    }
    if (!executablePath.trim() && !commandName.trim()) {
      nextErrors.config = "请提供可执行文件路径或命令名称。";
    }

    setErrors(nextErrors);
    setErrorMessage(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      if (isEdit) {
        await updateTool(entry!.id, {
          name: name.trim() || null,
          executablePath: executablePath.trim(),
          commandName: commandName.trim(),
        });
      } else {
        await addTool({
          toolId: isCustom ? null : selectedToolId,
          name: name.trim() || null,
          toolType: isCustom ? toolType : null,
          executablePath: executablePath.trim(),
          commandName: commandName.trim(),
        });
      }
      reset();
      onClose();
    } catch (cause) {
      setErrorMessage(toErrorMessage(cause, "保存工具配置失败。"));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? "编辑工具配置" : "添加工具"}
      description={
        isEdit
          ? "更新该工具的可执行文件或命令信息。"
          : "登记一个内置工具或自定义工具，并记录其本地路径。"
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="tool-config-form"
            disabled={busy}
          >
            {busy ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <form id="tool-config-form" className={styles.form} onSubmit={handleSubmit}>
        {isEdit ? (
          <div className={styles.summary}>
            <span className={styles.summaryName}>{entry!.name}</span>
            <span className={styles.summaryMeta}>
              {entry!.isCustom ? "自定义工具" : entry!.vendor} ·{" "}
              {TOOL_TYPE_LABEL[entry!.toolType]}
            </span>
          </div>
        ) : (
          <SelectField
            label="工具"
            required
            value={selectedToolId}
            options={[
              ...builtInOptions,
              { value: CUSTOM_VALUE, label: "自定义工具…" },
            ]}
            hint="选择内置工具以获得自动检测能力，或添加自定义工具。"
            onChange={(event) => {
              setSelectedToolId(event.target.value);
              setErrors({});
              setErrorMessage(null);
            }}
          />
        )}

        {!isEdit && isCustom && (
          <SegmentedControl
            ariaLabel="工具类型"
            options={TYPE_OPTIONS}
            value={toolType}
            onChange={setToolType}
          />
        )}

        <TextField
          label={isCustom ? "工具名称" : "显示名称（可选）"}
          placeholder={presetDefinition?.label ?? "例如 My AI Assistant"}
          value={name}
          required={isCustom}
          error={errors.name}
          hint={isCustom ? undefined : "留空则使用工具默认名称。"}
          onChange={(event) => setName(event.target.value)}
        />

        <div className={styles.pickerRow}>
          <TextField
            label="可执行文件路径"
            placeholder="例如 D:\\tools\\my-tool.exe"
            value={executablePath}
            error={errors.config}
            hint="可执行文件与命令名称二选一填写。"
            onChange={(event) => {
              setExecutablePath(event.target.value);
              setErrors((prev) => ({ ...prev, config: undefined }));
            }}
          />
          <Button
            variant="secondary"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={browseForExecutable}
            type="button"
          >
            浏览…
          </Button>
        </div>

        <TextField
          label="命令名称"
          placeholder="例如 my-tool"
          value={commandName}
          hint="在系统 PATH 中查找的命令。"
          onChange={(event) => setCommandName(event.target.value)}
          onBlur={checkCommand}
        />

        {commandName.trim() && commandPreview !== null && (
          <p className={styles.preview}>
            {commandPreview ? (
              <>
                解析为：<code>{commandPreview}</code>
              </>
            ) : (
              "未能在系统 PATH 中找到该命令；保存后可稍后重试检测。"
            )}
          </p>
        )}

        {errorMessage && <Notice tone="danger">{errorMessage}</Notice>}
      </form>
    </Modal>
  );
}
