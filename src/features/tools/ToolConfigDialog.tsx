import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import { useTools } from "../../context/ToolsContext";
import { useI18n } from "../../i18n";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { pickFile } from "../../services/dialog";
import { resolveToolCommand } from "../../services/tools";
import { toErrorMessage } from "../../services/backend";
import { TOOL_TYPE_KEY } from "./data";
import type { ToolEntry, ToolType } from "../../types/domain";
import styles from "./ToolConfigDialog.module.css";

const CUSTOM_VALUE = "__custom__";

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
  const { t } = useI18n();
  const isEdit = entry !== null;

  const typeOptions = useMemo(
    () => [
      { value: "desktop" as ToolType, label: t(TOOL_TYPE_KEY.desktop) },
      { value: "cli" as ToolType, label: t(TOOL_TYPE_KEY.cli) },
    ],
    [t],
  );

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
      nextErrors.name = t("toolConfig.errName");
    }
    if (!executablePath.trim() && !commandName.trim()) {
      nextErrors.config = t("toolConfig.errConfig");
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
      setErrorMessage(toErrorMessage(cause, t("toolConfig.failed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? t("toolConfig.titleEdit") : t("toolConfig.titleCreate")}
      description={
        isEdit
          ? t("toolConfig.descriptionEdit")
          : t("toolConfig.descriptionCreate")
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="tool-config-form"
            disabled={busy}
          >
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <form id="tool-config-form" className={styles.form} onSubmit={handleSubmit}>
        {isEdit ? (
          <div className={styles.summary}>
            <span className={styles.summaryName}>{entry!.name}</span>
            <span className={styles.summaryMeta}>
              {entry!.isCustom ? t("toolConfig.customTool") : entry!.vendor} ·{" "}
              {t(TOOL_TYPE_KEY[entry!.toolType])}
            </span>
          </div>
        ) : (
          <SelectField
            label={t("toolConfig.toolLabel")}
            required
            value={selectedToolId}
            options={[
              ...builtInOptions,
              { value: CUSTOM_VALUE, label: t("toolConfig.customOption") },
            ]}
            hint={t("toolConfig.toolHint")}
            onChange={(event) => {
              setSelectedToolId(event.target.value);
              setErrors({});
              setErrorMessage(null);
            }}
          />
        )}

        {!isEdit && isCustom && (
          <SegmentedControl
            ariaLabel={t("toolConfig.typeAria")}
            options={typeOptions}
            value={toolType}
            onChange={setToolType}
          />
        )}

        <TextField
          label={
            isCustom
              ? t("toolConfig.nameLabelCustom")
              : t("toolConfig.nameLabelBuiltin")
          }
          placeholder={presetDefinition?.label ?? "My AI Assistant"}
          value={name}
          required={isCustom}
          error={errors.name}
          hint={isCustom ? undefined : t("toolConfig.nameHint")}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label={t("toolConfig.exeLabel")}
          placeholder={t("toolConfig.exePlaceholder")}
          value={executablePath}
          error={errors.config}
          hint={t("toolConfig.exeHint")}
          trailing={
            <Button
              variant="secondary"
              icon={<FolderOpen size={14} aria-hidden="true" />}
              onClick={browseForExecutable}
              type="button"
            >
              {t("common.browse")}
            </Button>
          }
          onChange={(event) => {
            setExecutablePath(event.target.value);
            setErrors((prev) => ({ ...prev, config: undefined }));
          }}
        />

        <TextField
          label={t("toolConfig.cmdLabel")}
          placeholder={t("toolConfig.cmdPlaceholder")}
          value={commandName}
          hint={t("toolConfig.cmdHint")}
          onChange={(event) => setCommandName(event.target.value)}
          onBlur={checkCommand}
        />

        {commandName.trim() && commandPreview !== null && (
          <p className={styles.preview}>
            {commandPreview ? (
              <>
                {t("toolConfig.resolvePrefix")}
                <code>{commandPreview}</code>
              </>
            ) : (
              t("toolConfig.cmdNotFound")
            )}
          </p>
        )}

        {errorMessage && <Notice tone="danger">{errorMessage}</Notice>}
      </form>
    </Modal>
  );
}
