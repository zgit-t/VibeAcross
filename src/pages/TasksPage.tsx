import { useEffect, useMemo, useState } from "react";
import { ListPlus, Plus, SearchX } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useTaskList } from "../context/TasksContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { TaskDialog } from "../features/tasks/TaskDialog";
import { TaskList } from "../features/tasks/TaskList";
import {
  taskPriorityOptions,
  taskSortOptions,
  taskStatusLabel,
  TASK_STATUS_ORDER,
} from "../features/tasks/meta";
import { isDesktopRuntime } from "../services/backend";
import { getTask } from "../services/tasks";
import type { Task, TaskPriority, TaskSort, TaskStatus } from "../types/domain";
import styles from "./TasksPage.module.css";

type StatusFilter = "all" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;
type ProjectFilter = "all" | string;

/** 任务管理页面：筛选、搜索、排序并管理任务。 */
export function TasksPage() {
  const desktopAvailable = isDesktopRuntime();
  const { pendingTaskId, clearPendingTask, openProject } = useApp();
  const { projects } = useProjects();
  const { t } = useI18n();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [sort, setSort] = useState<TaskSort>("updated");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // 输入停顿后再查询，避免每次按键都触发数据库请求。
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 消费来自全局搜索等处的任务深链，打开对应任务的编辑弹窗。
  useEffect(() => {
    if (!pendingTaskId || !desktopAvailable) {
      return;
    }
    let cancelled = false;
    getTask(pendingTaskId)
      .then((task) => {
        if (!cancelled) {
          setEditing(task);
          setDialogOpen(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          clearPendingTask();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingTaskId, desktopAvailable, clearPendingTask]);

  const query = useMemo(
    () => ({
      projectId: projectFilter === "all" ? null : projectFilter,
      status: statusFilter === "all" ? null : statusFilter,
      priority: priorityFilter === "all" ? null : priorityFilter,
      search: search || null,
      sort,
    }),
    [projectFilter, statusFilter, priorityFilter, search, sort],
  );

  const { tasks, loading, error } = useTaskList(query);

  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  );
  const statusOptions = useMemo(
    () => [
      { value: "all" as StatusFilter, label: t("tasks.allStatus") },
      ...TASK_STATUS_ORDER.map((value) => ({
        value: value as StatusFilter,
        label: taskStatusLabel(t, value),
      })),
    ],
    [t],
  );
  const priorityOptions = useMemo(() => taskPriorityOptions(t), [t]);
  const sortOptions = useMemo(() => taskSortOptions(t), [t]);

  const hasFilters =
    search.length > 0 ||
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    projectFilter !== "all";

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setDialogOpen(true);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setProjectFilter("all");
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("tasks.title")}
        description={t("tasks.description")}
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={openCreate}
            disabled={!desktopAvailable || projects.length === 0}
          >
            {t("tasks.new")}
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="warning" title={t("tasks.notDesktopTitle")}>
          {t("tasks.notDesktopBody")}
        </Notice>
      )}

      {desktopAvailable && projects.length === 0 && (
        <Notice tone="info" title={t("tasks.needProjectTitle")}>
          {t("tasks.needProjectBody")}
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <div className={styles.toolbar}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder={t("tasks.searchPlaceholder")}
          label={t("tasks.searchLabel")}
        />

        <select
          className={styles.filterSelect}
          aria-label={t("tasks.filterProjectAria")}
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="all">{t("tasks.allProjects")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          className={styles.filterSelect}
          aria-label={t("tasks.filterPriorityAria")}
          value={priorityFilter}
          onChange={(event) =>
            setPriorityFilter(event.target.value as PriorityFilter)
          }
        >
          <option value="all">{t("tasks.allPriorities")}</option>
          {priorityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t("tasks.priorityOption", { label: option.label })}
            </option>
          ))}
        </select>

        <span className={styles.count}>
          {loading
            ? t("tasks.countLoading", { count: tasks.length })
            : t("tasks.count", { count: tasks.length })}
        </span>
      </div>

      <div className={styles.toolbar}>
        <SegmentedControl
          ariaLabel={t("tasks.filterStatusAria")}
          size="sm"
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <SegmentedControl
          ariaLabel={t("tasks.sortAria")}
          size="sm"
          options={sortOptions}
          value={sort}
          onChange={setSort}
        />
      </div>

      <div className={styles.listWrap}>
        {tasks.length > 0 ? (
          <TaskList
            tasks={tasks}
            projectNameById={projectNameById}
            onEdit={openEdit}
            onOpenProject={openProject}
          />
        ) : hasFilters ? (
          <EmptyState
            icon={SearchX}
            title={t("tasks.noMatchTitle")}
            description={t("tasks.noMatchDescription")}
            action={
              <Button variant="secondary" onClick={clearFilters}>
                {t("common.clearFilter")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ListPlus}
            title={t("tasks.emptyTitle")}
            description={t("tasks.emptyDescription")}
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={openCreate}
                disabled={!desktopAvailable || projects.length === 0}
              >
                {t("tasks.new")}
              </Button>
            }
          />
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editing}
        defaultProjectId={projectFilter === "all" ? null : projectFilter}
        projectOptions={projectOptions}
      />
    </div>
  );
}
