import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  FolderOpen,
  FolderSearch,
  Play,
  RefreshCw,
  Star,
  StarOff,
  Trash2,
  Wrench,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useTools } from "../../context/ToolsContext";
import { useI18n } from "../../i18n";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Drawer } from "../../components/ui/Drawer";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { pickDirectory } from "../../services/dialog";
import { copyText } from "../../services/clipboard";
import { toErrorMessage } from "../../services/backend";
import {
  LAUNCH_METHOD_KEY,
  LAUNCH_SUPPORT_KEY,
  LAUNCH_SUPPORT_TONE,
} from "../tools/data";
import {
  PATH_STATUS_KEY,
  PATH_STATUS_TONE,
  TOOL_HEALTH_KEY,
  TOOL_HEALTH_TONE,
  isPathHealthy,
  needsToolAttention,
} from "./health";
import { formatDateTime } from "../../utils/format";
import { ProjectTasksSection } from "./ProjectTasksSection";
import { buildLaunchNotice } from "./launchNotice";
import type {
  Project,
  ProjectHealth,
  ProjectPathStatus,
  ProjectToolHealth,
} from "../../types/domain";
import styles from "./ProjectDetailDrawer.module.css";

interface ProjectDetailDrawerProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

/** 项目详情抽屉：重命名、编辑备注、收藏、重新定位与移除。 */
export function ProjectDetailDrawer({
  project,
  open,
  onClose,
}: ProjectDetailDrawerProps) {
  const {
    renameProject,
    updateDescription,
    setFavorite,
    relocate,
    remove,
    setProjectTool,
    launchProject,
    openDirectory,
    checkHealth,
  } = useProjects();
  const { tools, refresh: refreshTools } = useTools();
  const { navigate } = useApp();
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const syncedIdRef = useRef<string | null>(null);

  // 项目路径健康与默认工具启动能力分开呈现；未检查完成前回退到列表已知状态。
  const pathStatus: ProjectPathStatus =
    health?.pathStatus ?? (project?.pathExists ? "ok" : "missing");
  const toolHealth: ProjectToolHealth = health?.toolStatus ?? "notConfigured";

  // 只有「已检测到」的工具可以关联为项目默认工具。
  const installedTools = useMemo(
    () => tools.filter((tool) => tool.installed),
    [tools],
  );
  const selectedTool = project?.defaultToolId
    ? tools.find((tool) => tool.id === project.defaultToolId) ?? null
    : null;

  const toolOptions = useMemo(() => {
    const options = installedTools.map((tool) => ({
      value: tool.id,
      label: tool.name,
    }));
    if (
      project?.defaultToolId &&
      !options.some((option) => option.value === project.defaultToolId)
    ) {
      const found = tools.find((tool) => tool.id === project.defaultToolId);
      options.unshift({
        value: project.defaultToolId,
        label: found
          ? t("projectDetail.toolCurrentUnavailable", { name: found.name })
          : t("projectDetail.toolRemoved"),
      });
    }
    return [{ value: "", label: t("projectList.noTool") }, ...options];
  }, [installedTools, tools, project?.defaultToolId, t]);

  // 仅在抽屉「打开某个项目」时载入草稿，避免列表刷新覆盖用户正在编辑的内容。
  useEffect(() => {
    if (!open || !project) {
      if (!open) {
        syncedIdRef.current = null;
      }
      return;
    }
    if (syncedIdRef.current === project.id) {
      return;
    }
    syncedIdRef.current = project.id;
    setName(project.name);
    setDescription(project.description ?? "");
    setError(null);
    setLaunchNotice(null);
    setConfirmRemove(false);
    setHealth(null);
    setCopied(false);
    setPendingPath(null);
    // 打开项目时按需做一次健康检查（只读）。
    void runHealth(project.id, false);
  }, [open, project]);

  async function runHealth(projectId: string, revalidate: boolean) {
    setChecking(true);
    setError(null);
    try {
      const result = await checkHealth(projectId, revalidate);
      setHealth(result);
      if (revalidate) {
        // 重新校验了默认工具路径，刷新工具状态以保持界面一致。
        await refreshTools();
      }
    } catch (cause) {
      setError(toErrorMessage(cause, t("health.recheckFailed")));
    } finally {
      setChecking(false);
    }
  }

  function handleRecheck() {
    if (!project) {
      return;
    }
    void runHealth(project.id, true);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(toErrorMessage(cause, t("projectDetail.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  function handleRename() {
    if (!project) {
      return;
    }
    if (!name.trim()) {
      setError(t("projectDetail.nameEmpty"));
      return;
    }
    if (name.trim() === project.name) {
      return;
    }
    void run(() => renameProject(project.id, name.trim()));
  }

  function handleSaveDescription() {
    if (!project) {
      return;
    }
    const next = description.trim();
    void run(() => updateDescription(project.id, next ? next : null));
  }

  function handleToggleFavorite() {
    if (!project) {
      return;
    }
    void run(() => setFavorite(project.id, !project.isFavorite));
  }

  function handleSetTool(toolId: string | null) {
    if (!project) {
      return;
    }
    setLaunchNotice(null);
    void run(async () => {
      await setProjectTool(project.id, toolId);
      // 默认工具变化会影响启动能力判定。
      await runHealth(project.id, false);
    });
  }

  async function handleLaunch() {
    if (!project || !project.defaultToolId) {
      return;
    }
    setLaunching(true);
    setError(null);
    setLaunchNotice(null);
    try {
      const result = await launchProject(project.id, project.defaultToolId);
      setLaunchNotice(buildLaunchNotice(result, t, "projectDetail.launched"));
    } catch (cause) {
      setError(toErrorMessage(cause, t("projectDetail.launchFailed")));
    } finally {
      setLaunching(false);
    }
  }

  async function handleRelocate() {
    if (!project) {
      return;
    }
    const selected = await pickDirectory({ defaultPath: project.path });
    if (!selected || selected === project.path) {
      return;
    }
    // 不立即写入：先让用户确认（不移动 / 复制 / 删除任何源代码）。
    setPendingPath(selected);
  }

  function confirmRelocate() {
    if (!project || !pendingPath) {
      return;
    }
    const target = pendingPath;
    setPendingPath(null);
    void run(async () => {
      await relocate(project.id, target);
      await runHealth(project.id, false);
    });
  }

  async function handleOpenDir() {
    if (!project) {
      return;
    }
    setError(null);
    try {
      await openDirectory(project.id);
    } catch (cause) {
      setError(toErrorMessage(cause, t("health.openFailed")));
    }
  }

  async function handleCopyPath() {
    if (!project) {
      return;
    }
    const ok = await copyText(project.path);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      setError(t("health.copyFailed"));
    }
  }

  function handleRemove() {
    if (!project) {
      return;
    }
    void run(async () => {
      await remove(project.id);
      setConfirmRemove(false);
      onClose();
    });
  }

  return (
    <>
      <Drawer
        open={open}
        title={project?.name ?? t("projectDetail.title")}
        subtitle={project?.path}
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        }
      >
        {project && (
          <>
            {!isPathHealthy(pathStatus) && (
              <Notice tone="warning" title={t("projectDetail.dirUnavailableTitle")}>
                {t("projectDetail.dirUnavailableBody")}
              </Notice>
            )}

            {error && <Notice tone="danger">{error}</Notice>}

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.label}>{t("health.sectionTitle")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  onClick={handleRecheck}
                  disabled={checking || busy}
                >
                  {checking ? t("health.rechecking") : t("health.recheck")}
                </Button>
              </div>

              <div className={styles.healthGrid}>
                <div className={styles.healthRow}>
                  <span className={styles.healthKey}>
                    {t("health.pathLabel")}
                  </span>
                  <Badge tone={PATH_STATUS_TONE[pathStatus]}>
                    {t(PATH_STATUS_KEY[pathStatus])}
                  </Badge>
                </div>
                <div className={styles.healthRow}>
                  <span className={styles.healthKey}>
                    {t("health.toolLabel")}
                  </span>
                  <Badge tone={TOOL_HEALTH_TONE[toolHealth]}>
                    {t(TOOL_HEALTH_KEY[toolHealth])}
                  </Badge>
                </div>
              </div>

              {!isPathHealthy(pathStatus) && (
                <p className={styles.hint}>{t("health.pathHint")}</p>
              )}

              {needsToolAttention(toolHealth) && (
                <div className={styles.inlineEnd}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Wrench size={14} aria-hidden="true" />}
                    onClick={() => navigate("tools")}
                  >
                    {t("health.goTools")}
                  </Button>
                </div>
              )}
            </section>

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.nameLabel")}</span>
              <div className={styles.inline}>
                <input
                  className={styles.input}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label={t("projectDetail.nameAria")}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRename}
                  disabled={busy}
                >
                  {t("common.save")}
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.notesLabel")}</span>
              <textarea
                className={styles.textarea}
                value={description}
                placeholder={t("projectDetail.notesPlaceholder")}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                aria-label={t("projectDetail.notesAria")}
              />
              <div className={styles.inlineEnd}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveDescription}
                  disabled={busy}
                >
                  {t("projectDetail.saveNotes")}
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.pathLabel")}</span>
              <code className={styles.path}>{project.path}</code>
              <div className={styles.pathActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FolderOpen size={14} aria-hidden="true" />}
                  onClick={handleOpenDir}
                  disabled={!isPathHealthy(pathStatus)}
                >
                  {t("health.openDir")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={
                    copied ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Copy size={14} aria-hidden="true" />
                    )
                  }
                  onClick={handleCopyPath}
                >
                  {copied ? t("health.copied") : t("health.copyPath")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FolderSearch size={14} aria-hidden="true" />}
                  onClick={handleRelocate}
                  disabled={busy}
                >
                  {t("projectDetail.relocate")}
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.favoriteLabel")}</span>
              <div className={styles.inline}>
                <Button
                  variant={project.isFavorite ? "primary" : "secondary"}
                  size="sm"
                  icon={
                    project.isFavorite ? (
                      <Star size={14} aria-hidden="true" />
                    ) : (
                      <StarOff size={14} aria-hidden="true" />
                    )
                  }
                  onClick={handleToggleFavorite}
                  disabled={busy}
                >
                  {project.isFavorite
                    ? t("projectDetail.favorited")
                    : t("projectDetail.addFavorite")}
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.toolsLabel")}</span>

              {installedTools.length === 0 ? (
                <>
                  <p className={styles.hint}>{t("projectDetail.noTools")}</p>
                  <div className={styles.inlineEnd}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Wrench size={14} aria-hidden="true" />}
                      onClick={() => navigate("tools")}
                    >
                      {t("projectDetail.goTools")}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <SelectField
                    label={t("projectDetail.defaultToolLabel")}
                    options={toolOptions}
                    value={project.defaultToolId ?? ""}
                    onChange={(event) =>
                      handleSetTool(event.target.value || null)
                    }
                    disabled={busy}
                    hint={t("projectDetail.defaultToolHint")}
                  />

                  {selectedTool && (
                    <div className={styles.launchStatus}>
                      <Badge
                        tone={LAUNCH_SUPPORT_TONE[selectedTool.launch.support]}
                      >
                        {t(LAUNCH_SUPPORT_KEY[selectedTool.launch.support])}
                      </Badge>
                      {selectedTool.launch.method && (
                        <span className={styles.launchMethod}>
                          {t(LAUNCH_METHOD_KEY[selectedTool.launch.method])}
                        </span>
                      )}
                    </div>
                  )}

                  {selectedTool &&
                    selectedTool.launch.support !== "supported" && (
                      <p className={styles.hint}>{selectedTool.launch.reason}</p>
                    )}

                  {launchNotice && (
                    <Notice tone="success" title={launchNotice.title}>
                      {launchNotice.message}
                    </Notice>
                  )}

                  <div className={styles.inlineEnd}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Play size={14} aria-hidden="true" />}
                      onClick={handleLaunch}
                      disabled={
                        busy ||
                        launching ||
                        !selectedTool ||
                        selectedTool.launch.support !== "supported" ||
                        !isPathHealthy(pathStatus)
                      }
                    >
                      {t("projectDetail.launch")}
                    </Button>
                  </div>
                </>
              )}
            </section>

            <ProjectTasksSection
              projectId={project.id}
              projectName={project.name}
            />

            <section className={styles.section}>
              <span className={styles.label}>{t("projectDetail.infoLabel")}</span>
              <dl className={styles.meta}>
                <div>
                  <dt>{t("projectDetail.createdAt")}</dt>
                  <dd>{formatDateTime(project.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t("projectDetail.updatedAt")}</dt>
                  <dd>{formatDateTime(project.updatedAt)}</dd>
                </div>
                <div>
                  <dt>{t("projectDetail.lastOpened")}</dt>
                  <dd>{formatDateTime(project.lastOpenedAt)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.danger}>
              <span className={styles.label}>{t("projectDetail.dangerLabel")}</span>
              <p className={styles.dangerHint}>{t("projectDetail.dangerHint")}</p>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
              >
                {t("projectDetail.removeProject")}
              </Button>
            </section>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmRemove}
        title={t("projectDetail.confirmRemoveTitle")}
        description={
          project
            ? t("projectDetail.confirmRemoveDescription", { name: project.name })
            : undefined
        }
        confirmLabel={t("common.remove")}
        tone="danger"
        busy={busy}
        onConfirm={handleRemove}
        onClose={() => setConfirmRemove(false)}
      />

      <ConfirmDialog
        open={pendingPath !== null}
        title={t("health.relocateConfirmTitle")}
        description={
          pendingPath
            ? t("health.relocateConfirmDescription", {
                name: project?.name ?? "",
                path: pendingPath,
              })
            : undefined
        }
        confirmLabel={t("health.relocateConfirmAction")}
        busy={busy}
        onConfirm={confirmRelocate}
        onClose={() => setPendingPath(null)}
      />
    </>
  );
}
