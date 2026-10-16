import { useMemo, useState } from "react";
import { FolderPlus, Plus, RefreshCw, SearchX } from "lucide-react";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
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
import { toErrorMessage } from "../services/backend";
import type { Project, ProjectSort } from "../types/domain";
import styles from "./ProjectsPage.module.css";

const SORT_OPTIONS: Array<{ value: ProjectSort; label: string }> = [
  { value: "recent", label: "最近访问" },
  { value: "created", label: "创建时间" },
  { value: "name", label: "名称" },
];

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
  } = useProjects();
  const { tools } = useTools();

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

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesQuery =
        !keyword ||
        project.name.toLowerCase().includes(keyword) ||
        project.path.toLowerCase().includes(keyword);
      const matchesFavorite = !favoritesOnly || project.isFavorite;
      return matchesQuery && matchesFavorite;
    });
  }, [projects, query, favoritesOnly]);

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
      setActionError(toErrorMessage(cause, "移除项目失败。"));
    } finally {
      setRemoving(false);
    }
  }

  async function handleToggleFavorite(project: Project) {
    setActionError(null);
    try {
      await setFavorite(project.id, !project.isFavorite);
    } catch (cause) {
      setActionError(toErrorMessage(cause, "更新收藏状态失败。"));
    }
  }

  async function handleSetTool(project: Project, toolId: string | null) {
    setActionError(null);
    setLaunchNotice(null);
    try {
      await setProjectTool(project.id, toolId);
    } catch (cause) {
      setActionError(toErrorMessage(cause, "设置默认工具失败。"));
    }
  }

  async function handleLaunch(project: Project, toolId: string) {
    setLaunchingId(project.id);
    setLaunchNotice(null);
    try {
      const result = await launchProject(project.id, toolId);
      setLaunchNotice({
        tone: "success",
        title: `已在项目中启动 ${result.toolName}`,
        message: `工作目录：${result.workingDir}`,
      });
    } catch (cause) {
      setLaunchNotice({
        tone: "danger",
        title: "启动工具失败",
        message: toErrorMessage(cause),
      });
    } finally {
      setLaunchingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Projects"
        description="管理本地开发项目。数据保存在本机的 SQLite 数据库中。"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={() => setAddOpen(true)}
            disabled={!desktopAvailable}
          >
            Add Project
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="warning" title="未连接本地数据">
          当前不在桌面应用中运行，项目数据不可用。
        </Notice>
      )}

      {error && (
        <Notice tone="danger" title="读取失败">
          {error}
          <div className={styles.noticeAction}>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={() => void refresh()}
            >
              重试
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
          placeholder="搜索项目名称或路径…"
          label="搜索项目"
        />
        <SegmentedControl
          ariaLabel="项目排序方式"
          size="sm"
          options={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
        />
        <Switch
          label="只看收藏"
          checked={favoritesOnly}
          onChange={setFavoritesOnly}
        />
        <span className={styles.count}>
          {filtered.length} / {projects.length} 个项目
        </span>
      </div>

      <div className={styles.listWrap}>
        {loading && !hasProjects ? (
          <p className={styles.status}>正在加载项目…</p>
        ) : !hasProjects ? (
          <EmptyState
            icon={FolderPlus}
            title="还没有项目"
            description="创建一个新的项目目录，或导入一个已存在的本地目录。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setAddOpen(true)}
                disabled={!desktopAvailable}
              >
                Add Project
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
            onSetTool={handleSetTool}
            onLaunch={handleLaunch}
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="没有匹配的项目"
            description="尝试调整搜索关键词或筛选条件。"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFavoritesOnly(false);
                }}
              >
                清除筛选
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
        title="移除项目？"
        description={
          pendingRemove
            ? `将从列表中移除「${pendingRemove.name}」，磁盘目录保持不动。`
            : undefined
        }
        confirmLabel="移除"
        tone="danger"
        busy={removing}
        onConfirm={handleRemove}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  );
}
