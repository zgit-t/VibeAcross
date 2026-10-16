import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Plus, RefreshCw, SearchX } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Switch } from "../components/ui/Switch";
import { ProjectList } from "../features/projects/ProjectList";
import { AddProjectDialog } from "../features/projects/AddProjectDialog";
import { ProjectDetailDrawer } from "../features/projects/ProjectDetailDrawer";
import { filterProjects } from "../features/projects/filter";
import { buildLaunchNotice } from "../features/projects/launchNotice";
import { toErrorMessage } from "../services/backend";
import { copyText } from "../services/clipboard";
import type { Project, ProjectSort } from "../types/domain";
import styles from "./ProjectsPage.module.css";

/** 项目列表页面。数据来自本地 SQLite。 */
export function ProjectsPage() {
  const {
    projects,
    loading,
    error,
    desktopAvailable,
    sort,
    setSort,
    refresh,
    setFavorite,
    remove,
    touchOpened,
    setProjectTool,
    launchProject,
    openDirectory,
  } = useProjects();
  const { tools } = useTools();
  const { pendingProjectId, clearPendingProject } = useApp();
  const { t } = useI18n();

  const sortOptions = useMemo<Array<{ value: ProjectSort; label: string }>>(
    () => [
      { value: "recent", label: t("projects.sort.recent") },
      { value: "created", label: t("projects.sort.created") },
      { value: "name", label: t("projects.sort.name") },
    ],
    [t],
  );

  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Project | null>(null);
  const [removing, setRemoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<{
    tone: "success" | "danger";
    title: string;
    message?: string;
  } | null>(null);

  const selected = selectedId
    ? projects.find((project) => project.id === selectedId) ?? null
    : null;

  // 消费来自其它页面（如 Overview）的项目深链，打开对应详情。
  useEffect(() => {
    if (!pendingProjectId || loading) {
      return;
    }
    const target = projects.find((project) => project.id === pendingProjectId);
    if (target) {
      setSelectedId(target.id);
      setActionError(null);
      void touchOpened(target.id).catch(() => undefined);
    } else {
      setActionError(t("projects.notFound"));
    }
    clearPendingProject();
  }, [
    pendingProjectId,
    loading,
    projects,
    touchOpened,
    clearPendingProject,
    t,
  ]);

  const filtered = useMemo(
    () => filterProjects(projects, query, favoritesOnly),
    [projects, query, favoritesOnly],
  );

  const hasProjects = projects.length > 0;

  function openDetail(project: Project) {
    setSelectedId(project.id);
    setActionError(null);
    void touchOpened(project.id).catch(() => undefined);
  }

  async function handleRemove() {
    if (!pendingRemove) {
      return;
    }
    setRemoving(true);
    setActionError(null);
    try {
      await remove(pendingRemove.id);
      if (selectedId === pendingRemove.id) {
        setSelectedId(null);
      }
      setPendingRemove(null);
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("projects.removeFailed")));
    } finally {
      setRemoving(false);
    }
  }

  async function handleToggleFavorite(project: Project) {
    setActionError(null);
    try {
      await setFavorite(project.id, !project.isFavorite);
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("projects.favoriteFailed")));
    }
  }

  async function handleSetTool(project: Project, toolId: string | null) {
    setActionError(null);
    setLaunchNotice(null);
    try {
      await setProjectTool(project.id, toolId);
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("projects.setToolFailed")));
    }
  }

  async function handleLaunch(project: Project, toolId: string) {
    setLaunchingId(project.id);
    setLaunchNotice(null);
    try {
      const result = await launchProject(project.id, toolId);
      setLaunchNotice({
        tone: "success",
        ...buildLaunchNotice(result, t),
      });
    } catch (cause) {
      setLaunchNotice({
        tone: "danger",
        title: t("projects.launchFailedTitle"),
        message: toErrorMessage(cause),
      });
    } finally {
      setLaunchingId(null);
    }
  }

  async function handleOpenDir(project: Project) {
    setActionError(null);
    try {
      await openDirectory(project.id);
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("health.openFailed")));
    }
  }

  async function handleCopyPath(project: Project) {
    setActionError(null);
    const ok = await copyText(project.path);
    if (ok) {
      setLaunchNotice({ tone: "success", title: t("health.copied") });
    } else {
      setActionError(t("health.copyFailed"));
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("projects.title")}
        description={t("projects.description")}
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setAddOpen(true)}
            disabled={!desktopAvailable}
          >
            {t("projects.add")}
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="warning" title={t("projects.notDesktopTitle")}>
          {t("projects.notDesktopBody")}
        </Notice>
      )}

      {error && (
        <Notice tone="danger" title={t("projects.loadFailedTitle")}>
          {error}
          <div className={styles.noticeAction}>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={() => void refresh()}
            >
              {t("common.retry")}
            </Button>
          </div>
        </Notice>
      )}

      {actionError && <Notice tone="danger">{actionError}</Notice>}

      {launchNotice && (
        <Notice tone={launchNotice.tone} title={launchNotice.title}>
          {launchNotice.message}
        </Notice>
      )}

      <div className={styles.toolbar}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("projects.searchPlaceholder")}
          label={t("projects.searchLabel")}
        />
        <SegmentedControl
          ariaLabel={t("projects.sortAria")}
          size="sm"
          options={sortOptions}
          value={sort}
          onChange={setSort}
        />
        <Switch
          label={t("projects.favoritesOnly")}
          checked={favoritesOnly}
          onChange={setFavoritesOnly}
        />
        <span className={styles.count}>
          {t("projects.count", {
            filtered: filtered.length,
            total: projects.length,
          })}
        </span>
      </div>

      <div className={styles.listWrap}>
        {loading && !hasProjects ? (
          <p className={styles.status}>{t("projects.loading")}</p>
        ) : !hasProjects ? (
          <EmptyState
            icon={FolderPlus}
            title={t("projects.emptyTitle")}
            description={t("projects.emptyDescription")}
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setAddOpen(true)}
                disabled={!desktopAvailable}
              >
                {t("projects.add")}
              </Button>
            }
          />
        ) : filtered.length > 0 ? (
          <ProjectList
            projects={filtered}
            showActions
            showLaunch
            tools={tools}
            launchingId={launchingId}
            onSelect={openDetail}
            onRename={openDetail}
            onToggleFavorite={handleToggleFavorite}
            onRemove={(project) => setPendingRemove(project)}
            onOpenDir={handleOpenDir}
            onCopyPath={handleCopyPath}
            onSetTool={handleSetTool}
            onLaunch={handleLaunch}
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title={t("projects.noMatchTitle")}
            description={t("projects.noMatchDescription")}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFavoritesOnly(false);
                }}
              >
                {t("common.clearFilter")}
              </Button>
            }
          />
        )}
      </div>

      <AddProjectDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={openDetail}
      />

      <ProjectDetailDrawer
        project={selected}
        open={selected !== null}
        onClose={() => setSelectedId(null)}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        title={t("projects.confirmRemoveTitle")}
        description={
          pendingRemove
            ? t("projects.confirmRemoveDescription", {
                name: pendingRemove.name,
              })
            : undefined
        }
        confirmLabel={t("common.remove")}
        tone="danger"
        busy={removing}
        onConfirm={handleRemove}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  );
}
