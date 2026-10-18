import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FolderOpen,
  FolderSearch,
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
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { pickDirectory } from "../../services/dialog";
import { copyText } from "../../services/clipboard";
import { toErrorMessage } from "../../services/backend";
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
import { ProjectSessionSection } from "../aiSessions/ProjectSessionSection";
import type {
  ProjectHealth,
  ProjectPathStatus,
  ProjectToolHealth,
} from "../../types/domain";
import styles from "./ProjectDetailDialog.module.css";

interface ProjectDetailDialogProps {
  projectId: string;
  onClose: () => void;
}

/**
 * 项目详情弹窗：重命名、编辑备注、收藏、重新定位、打开文件夹与移除。
 *
 * 以应用窗口居中的模态呈现，背后的项目列表保持可见与原有状态。所有数据与动作
 * 复用 `ProjectsContext` / `ToolsContext` 既有实现：打开文件夹走 `openDirectory`，
 * 运行工具与会话仍由 `ProjectSessionSection` 负责。关闭仅回到项目列表，
 * 不触发任何工具启动或会话创建。
 */
export function ProjectDetailDialog({
  projectId,
  onClose,
}: ProjectDetailDialogProps) {
  const {
    projects,
    loading,
    renameProject,
    updateDescription,
    setFavorite,
    relocate,
    remove,
    openDirectory,
    checkHealth,
  } = useProjects();
  const { tools, refresh: refreshTools } = useTools();
  const { navigate } = useApp();
  const { t } = useI18n();

  const project = projects.find((item) => item.id === projectId) ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // 仅在弹窗展示某个项目时载入草稿，避免列表刷新覆盖用户正在编辑的内容。
  useEffect(() => {
    if (!project) {
      return;
    }
    if (syncedIdRef.current === project.id) {
      return;
    }
    syncedIdRef.current = project.id;
    setName(project.name);
    setDescription(project.description ?? "");
    setError(null);
    setConfirmRemove(false);
    setHealth(null);
    setCopied(false);
    setPendingPath(null);
    // 打开弹窗时按需做一次健康检查（只读）。
    void runHealth(project.id, false);
  }, [project]);

  async function runHealth(targetId: string, revalidate: boolean) {
    setChecking(true);
    setError(null);
    try {
      const result = await checkHealth(targetId, revalidate);
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
    const targetId = project.id;
    setPendingPath(null);
    void run(async () => {
      await relocate(targetId, target);
      await runHealth(targetId, false);
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

  const pathHealthy = isPathHealthy(pathStatus);

  return (
    <>
      <Modal
        open
        title={project?.name ?? t("projectDetail.title")}
        description={project?.path}
        size="lg"
        onClose={onClose}
        footer={
          <>
            {project && (
              <Button
                variant="secondary"
                icon={<FolderOpen size={15} aria-hidden="true" />}
                onClick={handleOpenDir}
                disabled={!pathHealthy}
              >
                {t("projectDetail.openFolder")}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </>
        }
      >
        {!project ? (
          loading ? (
            <p className={styles.status}>{t("projects.loading")}</p>
          ) : (
            <EmptyState
              icon={FolderSearch}
              title={t("projectDetail.notFoundTitle")}
              description={t("projectDetail.notFoundDescription")}
            />
          )
        ) : (
          <div className={styles.content}>
            {!pathHealthy && (
              <Notice
                tone="warning"
                title={t("projectDetail.dirUnavailableTitle")}
              >
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

              {!pathHealthy && (
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
              <span className={styles.label}>
                {t("projectDetail.favoriteLabel")}
              </span>
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

            <ProjectSessionSection
              project={project}
              tools={tools}
              pathHealthy={pathHealthy}
            />

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
              <span className={styles.label}>
                {t("projectDetail.dangerLabel")}
              </span>
              <p className={styles.dangerHint}>
                {t("projectDetail.dangerHint")}
              </p>
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
          </div>
        )}
      </Modal>

      {project && (
        <>
          <ConfirmDialog
            open={confirmRemove}
            title={t("projectDetail.confirmRemoveTitle")}
            description={t("projectDetail.confirmRemoveDescription", {
              name: project.name,
            })}
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
                    name: project.name,
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
      )}
    </>
  );
}
