import { useEffect, useMemo, useState } from "react";
import { ListPlus, Plus, SearchX } from "lucide-react";
import { useProjects } from "../context/ProjectsContext";
import { useTaskList } from "../context/TasksContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { TaskDialog } from "../features/tasks/TaskDialog";
import { TaskList } from "../features/tasks/TaskList";
import {
  TASK_PRIORITY_OPTIONS,
  TASK_SORT_OPTIONS,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
} from "../features/tasks/meta";
import { isDesktopRuntime } from "../services/backend";
import type { Task, TaskPriority, TaskSort, TaskStatus } from "../types/domain";
import styles from "./TasksPage.module.css";

type StatusFilter = "all" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;
type ProjectFilter = "all" | string;

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  ...TASK_STATUS_ORDER.map((value) => ({
    value,
    label: TASK_STATUS_META[value].label,
  })),
];

/** 任务管理页面：筛选、搜索、排序并管理任务。 */
export function TasksPage() {
  const desktopAvailable = isDesktopRuntime();
  const { projects } = useProjects();

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
        title="Tasks"
        description="跟踪开发任务的进度、优先级与截止日期。"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={openCreate}
            disabled={!desktopAvailable || projects.length === 0}
          >
            New Task
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="warning" title="桌面运行时不可用">
          任务数据保存在本地 SQLite，仅在桌面应用中可用。
        </Notice>
      )}

      {desktopAvailable && projects.length === 0 && (
        <Notice tone="info" title="先创建项目">
          任务需要归属一个项目。请先在 Projects 页面创建或导入项目，再添加任务。
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <div className={styles.toolbar}>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="搜索任务标题或描述…"
          label="搜索任务"
        />

        <select
          className={styles.filterSelect}
          aria-label="按项目筛选"
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="all">全部项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          className={styles.filterSelect}
          aria-label="按优先级筛选"
          value={priorityFilter}
          onChange={(event) =>
            setPriorityFilter(event.target.value as PriorityFilter)
          }
        >
          <option value="all">全部优先级</option>
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              优先级 {option.label}
            </option>
          ))}
        </select>

        <span className={styles.count}>
          {tasks.length} 个任务{loading ? "（加载中…）" : ""}
        </span>
      </div>

      <div className={styles.toolbar}>
        <SegmentedControl
          ariaLabel="按状态筛选"
          size="sm"
          options={STATUS_FILTER_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <SegmentedControl
          ariaLabel="排序方式"
          size="sm"
          options={TASK_SORT_OPTIONS}
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
          />
        ) : hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="没有匹配的任务"
            description="尝试调整搜索关键词或筛选条件。"
            action={
              <Button variant="secondary" onClick={clearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ListPlus}
            title="还没有任务"
            description="创建任务来跟踪你的开发计划。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={openCreate}
                disabled={!desktopAvailable || projects.length === 0}
              >
                New Task
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
