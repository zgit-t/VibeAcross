import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { TextField } from "../../components/ui/TextField";
import { pickDirectory } from "../../services/dialog";
import { toErrorMessage } from "../../services/backend";
import type { Project } from "../../types/domain";
import styles from "./AddProjectDialog.module.css";

type Mode = "create" | "import";

const MODE_OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: "create", label: "创建新项目" },
  { value: "import", label: "导入已有目录" },
];

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: Project) => void;
}

interface FormErrors {
  name?: string;
  location?: string;
  path?: string;
}

/** 添加项目：支持「创建新项目」与「导入已有目录」两种方式，均写入 SQLite。 */
export function AddProjectDialog({
  open,
  onClose,
  onCreated,
}: AddProjectDialogProps) {
  const { defaultProjectFolder } = useApp();
  const { createProject, importProject } = useProjects();

  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 打开弹窗时以默认项目文件夹预填位置。
  useEffect(() => {
    if (open) {
      setLocation((prev) => prev || defaultProjectFolder || "");
    }
  }, [open, defaultProjectFolder]);

  function reset() {
    setMode("create");
    setName("");
    setLocation("");
    setImportPath("");
    setImportName("");
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

  async function browseForLocation() {
    const selected = await pickDirectory({ defaultPath: location || null });
    if (selected) {
      setLocation(selected);
      setErrors((prev) => ({ ...prev, location: undefined }));
    }
  }

  async function browseForImport() {
    const selected = await pickDirectory({ defaultPath: importPath || null });
    if (selected) {
      setImportPath(selected);
      setErrors((prev) => ({ ...prev, path: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FormErrors = {};

    if (mode === "create") {
      if (!name.trim()) {
        nextErrors.name = "请输入项目名称。";
      }
      if (!location.trim()) {
        nextErrors.location = "请选择项目所在目录。";
      }
    } else if (!importPath.trim()) {
      nextErrors.path = "请选择要导入的目录。";
    }

    setErrors(nextErrors);
    setErrorMessage(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      const project =
        mode === "create"
          ? await createProject({ name: name.trim(), location: location.trim() })
          : await importProject({
              path: importPath.trim(),
              name: importName.trim() ? importName.trim() : null,
            });
      onCreated?.(project);
      reset();
      onClose();
    } catch (cause) {
      setErrorMessage(toErrorMessage(cause, "添加项目失败。"));
      setBusy(false);
    }
  }

  const targetPreview =
    mode === "create" && location.trim() && name.trim()
      ? `${location.trim().replace(/[\\/]+$/, "")}\\${name.trim()}`
      : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="添加项目"
      description="创建新的项目目录，或导入一个已存在的本地目录。"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="add-project-form"
            disabled={busy}
          >
            {busy ? "处理中…" : mode === "create" ? "创建" : "导入"}
          </Button>
        </>
      }
    >
      <form id="add-project-form" className={styles.form} onSubmit={handleSubmit}>
        <SegmentedControl
          ariaLabel="添加项目方式"
          options={MODE_OPTIONS}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setErrors({});
            setErrorMessage(null);
          }}
        />

        {mode === "create" ? (
          <>
            <TextField
              label="项目名称"
              placeholder="例如 my-project"
              value={name}
              required
              error={errors.name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className={styles.pickerRow}>
              <TextField
                label="所在目录"
                placeholder="选择一个已存在的目录"
                value={location}
                required
                error={errors.location}
                hint="新项目目录将创建在该目录下。"
                onChange={(event) => setLocation(event.target.value)}
              />
              <Button
                variant="secondary"
                icon={<FolderOpen size={14} aria-hidden="true" />}
                onClick={browseForLocation}
                type="button"
              >
                浏览…
              </Button>
            </div>
            {targetPreview && (
              <p className={styles.preview}>
                将创建：<code>{targetPreview}</code>
              </p>
            )}
          </>
        ) : (
          <>
            <div className={styles.pickerRow}>
              <TextField
                label="目录路径"
                placeholder="选择要导入的本地目录"
                value={importPath}
                required
                error={errors.path}
                onChange={(event) => setImportPath(event.target.value)}
              />
              <Button
                variant="secondary"
                icon={<FolderOpen size={14} aria-hidden="true" />}
                onClick={browseForImport}
                type="button"
              >
                浏览…
              </Button>
            </div>
            <TextField
              label="项目名称（可选）"
              placeholder="留空则使用目录名"
              value={importName}
              onChange={(event) => setImportName(event.target.value)}
            />
          </>
        )}

        {errorMessage && <Notice tone="danger">{errorMessage}</Notice>}
      </form>
    </Modal>
  );
}
