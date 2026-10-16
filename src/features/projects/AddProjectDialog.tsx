import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FolderOpen } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();

  const modeOptions = useMemo<Array<{ value: Mode; label: string }>>(
    () => [
      { value: "create", label: t("addProject.modeCreate") },
      { value: "import", label: t("addProject.modeImport") },
    ],
    [t],
  );

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
        nextErrors.name = t("addProject.errName");
      }
      if (!location.trim()) {
        nextErrors.location = t("addProject.errLocation");
      }
    } else if (!importPath.trim()) {
      nextErrors.path = t("addProject.errPath");
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
      setErrorMessage(toErrorMessage(cause, t("addProject.failed")));
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
      title={t("addProject.title")}
      description={t("addProject.description")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="add-project-form"
            disabled={busy}
          >
            {busy
              ? t("common.processing")
              : mode === "create"
                ? t("common.create")
                : t("common.import")}
          </Button>
        </>
      }
    >
      <form id="add-project-form" className={styles.form} onSubmit={handleSubmit}>
        <SegmentedControl
          ariaLabel={t("addProject.modeAria")}
          options={modeOptions}
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
              label={t("addProject.nameLabel")}
              placeholder={t("addProject.namePlaceholder")}
              value={name}
              required
              error={errors.name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label={t("addProject.locationLabel")}
              placeholder={t("addProject.locationPlaceholder")}
              value={location}
              required
              error={errors.location}
              hint={t("addProject.locationHint")}
              trailing={
                <Button
                  variant="secondary"
                  icon={<FolderOpen size={14} aria-hidden="true" />}
                  onClick={browseForLocation}
                  type="button"
                >
                  {t("common.browse")}
                </Button>
              }
              onChange={(event) => setLocation(event.target.value)}
            />
            {targetPreview && (
              <p className={styles.preview}>
                {t("addProject.targetPreview")}
                <code>{targetPreview}</code>
              </p>
            )}
          </>
        ) : (
          <>
            <TextField
              label={t("addProject.importPathLabel")}
              placeholder={t("addProject.importPathPlaceholder")}
              value={importPath}
              required
              error={errors.path}
              trailing={
                <Button
                  variant="secondary"
                  icon={<FolderOpen size={14} aria-hidden="true" />}
                  onClick={browseForImport}
                  type="button"
                >
                  {t("common.browse")}
                </Button>
              }
              onChange={(event) => setImportPath(event.target.value)}
            />
            <TextField
              label={t("addProject.importNameLabel")}
              placeholder={t("addProject.importNamePlaceholder")}
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
