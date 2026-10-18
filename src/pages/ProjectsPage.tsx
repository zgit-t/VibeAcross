import { useEffect, useMemo, useState } from "react";
import { FolderPlus, Plus, RefreshCw, SearchX } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { Switch } from "../components/ui/Switch";
import { ProjectList } from "../features/projects/ProjectList";
import { AddProjectDialog } from "../features/projects/AddProjectDialog";
import { ProjectDetailDialog } from "../features/projects/ProjectDetailDialog";
import { RemoveProjectDialog } from "../features/projects/RemoveProjectDialog";
import { RunSessionFlow } from "../features/aiSessions/RunSessionFlow";
import { filterProjects } from "../features/projects/filter";
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
    touchOpened,
    setProjectTool,
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [runProject, setRunProject] = useState<Project | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "danger";
    title: string;
    message?: string;
  } | null>(null);

  // 消费来自其它页面（如 Overview）的项目深链，打开对应详情弹窗。
  useEffect(() => {
    if (!pendingProjectId || loading) {
      return;
    }
    setSelectedId(pendingProjectId);
    setActionError(null);
    const target = projects.find((project) => project.id === pendingProjectId);
    if (target) {
      void touchOpened(target.id).catch(() => undefined);
    }
    clearPendingProject();
  }, [
    pendingProjectId,
    loading,
    projects,
    touchOpened,
    clearPendingProject,
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
    setNotice(null);
    try {
      await setProjectTool(project.id, toolId);
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("projects.setToolFailed")));
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
      setNotice({ tone: "success", title: t("health.copied") });
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

      {notice && (
        <Notice tone={notice.tone} title={notice.title}>
          {notice.message}
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
            onSelect={openDetail}
            onRename={openDetail}
            onToggleFavorite={handleToggleFavorite}
            onRemove={(project) => setPendingRemove(project)}
            onOpenDir={handleOpenDir}
            onCopyPath={handleCopyPath}
            onSetTool={handleSetTool}
            onRun={(project) => setRunProject(project)}
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

      {selectedId && (
        <ProjectDetailDialog
          key={selectedId}
          projectId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}

      <RunSessionFlow
        key={runProject?.id ?? "none"}
        open={runProject !== null}
        project={runProject}
        initialToolId={runProject?.defaultToolId ?? null}
        onClose={() => setRunProject(null)}
        onToolChange={(toolId) => {
          const target = runProject;
          if (!target) {
            return;
          }
          // 立即反馈，同时持久化为项目的当前工具。
          setRunProject((current) =>
            current ? { ...current, defaultToolId: toolId } : current,
          );
          void handleSetTool(target, toolId);
        }}
      />

      <RemoveProjectDialog
        project={pendingRemove}
        onClose={() => setPendingRemove(null)}
        onRemoved={(removed) => {
          if (selectedId === removed.id) {
            setSelectedId(null);
          }
        }}
      />
    </div>
  );
}
