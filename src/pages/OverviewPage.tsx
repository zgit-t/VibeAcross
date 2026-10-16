import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FolderPlus,
  History,
  ListPlus,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
import { useTaskStats } from "../context/TasksContext";
import { useActivityFeed } from "../context/ActivityContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Section } from "../components/layout/Section";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Notice } from "../components/ui/Notice";
import { ProjectList } from "../features/projects/ProjectList";
import { AddProjectDialog } from "../features/projects/AddProjectDialog";
import { ActivityList } from "../features/activity/ActivityList";
import {
  getStatusLabel,
  getStatusTone,
} from "../features/tools/data";
import {
  RESTORE_LEVEL_LABEL,
  RESTORE_LEVEL_TONE,
  sessionName,
} from "../features/workspace/meta";
import { toErrorMessage } from "../services/backend";
import { formatRelativeTime } from "../utils/format";
import type { Project } from "../types/domain";
import styles from "./OverviewPage.module.css";

/** 按最近访问时间倒序比较（从未访问的排在最后）。 */
function compareRecent(a: Project, b: Project): number {
  if (a.lastOpenedAt === b.lastOpenedAt) {
    return b.createdAt.localeCompare(a.createdAt);
  }
  if (!a.lastOpenedAt) {
    return 1;
  }
  if (!b.lastOpenedAt) {
    return -1;
  }
  return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
}

/** 默认页面：本地开发工作区概览。 */
export function OverviewPage() {
  const { navigate, showLastContextOnStartup } = useApp();
  const { projects } = useProjects();
  const { tools } = useTools();
  const stats = useTaskStats();
  const recentActivity = useActivityFeed({}, 5).items;
  const {
    lastSession,
    autoRestore,
    dismissAutoRestore,
    restoreSession,
    desktopAvailable,
  } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  async function handleResume(id: string) {
    setResumeBusy(true);
    setResumeError(null);
    try {
      await restoreSession(id);
    } catch (cause) {
      setResumeError(toErrorMessage(cause, "恢复工作环境失败。"));
    } finally {
      setResumeBusy(false);
    }
  }

  const recentProjects = useMemo(
    () => [...projects].sort(compareRecent).slice(0, 4),
    [projects],
  );

  const toolSummary = useMemo(() => {
    const detected = tools.filter((tool) => tool.installed);
    const total = tools.length;
    return { detected, total };
  }, [tools]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Overview"
        description="Your development workspace at a glance."
      />

      {autoRestore.state !== "idle" && (
        <Notice
          tone={
            autoRestore.state === "failed"
              ? "danger"
              : autoRestore.state === "success"
                ? "success"
                : "info"
          }
          title={
            autoRestore.state === "running"
              ? "正在自动恢复"
              : autoRestore.state === "success"
                ? "已自动恢复"
                : "自动恢复失败"
          }
        >
          <div className={styles.bannerBody}>
            <span>
              {autoRestore.message ??
                "正在自动恢复上次的工作上下文…"}
            </span>
            <Button variant="ghost" size="sm" onClick={dismissAutoRestore}>
              知道了
            </Button>
          </div>
        </Notice>
      )}

      <Section
        title="Resume Work"
        description="恢复最近一次的工作环境（项目 + 开发工具）。"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("sessions")}
          >
            All Sessions
          </Button>
        }
      >
        {lastSession ? (
          <div className={styles.resume}>
            <div className={styles.resumeMain}>
              <div className={styles.resumeTitleRow}>
                <span className={styles.resumeTitle}>
                  {sessionName(lastSession)}
                </span>
                <Badge tone={RESTORE_LEVEL_TONE[lastSession.restoreLevel]}>
                  {RESTORE_LEVEL_LABEL[lastSession.restoreLevel]}
                </Badge>
                {showLastContextOnStartup && (
                  <Badge tone="accent">启动时显示</Badge>
                )}
              </div>
              <div className={styles.resumeMeta}>
                <span>{lastSession.projectName ?? "项目已删除"}</span>
                <span aria-hidden="true">·</span>
                <span>{lastSession.toolName ?? "未指定工具"}</span>
                {lastSession.taskTitle && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>任务：{lastSession.taskTitle}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>最近使用 {formatRelativeTime(lastSession.lastUsedAt)}</span>
              </div>
              {lastSession.lastRestoreStatus === "failed" &&
                lastSession.lastRestoreError && (
                  <p className={styles.resumeError}>
                    上次恢复失败：{lastSession.lastRestoreError}
                  </p>
                )}
            </div>
            <Button
              variant="primary"
              icon={<Play size={15} aria-hidden="true" />}
              disabled={resumeBusy || !desktopAvailable}
              onClick={() => void handleResume(lastSession.id)}
            >
              {resumeBusy ? "恢复中…" : "恢复"}
            </Button>
          </div>
        ) : (
          <EmptyState
            compact
            icon={RotateCcw}
            title="还没有工作上下文"
            description="在 Sessions 页面保存一个「项目 + 工具 + 任务」组合，即可一键恢复工作环境。"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("sessions")}
              >
                前往 Sessions
              </Button>
            }
          />
        )}
        {resumeError && (
          <div className={styles.resumeNotice}>
            <Notice tone="danger">{resumeError}</Notice>
          </div>
        )}
      </Section>

      <Section
        title="Recent Projects"
        description="最近访问的本地项目。"
        action={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("projects")}
            >
              All Projects
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={15} aria-hidden="true" />}
              onClick={() => setAddOpen(true)}
            >
              Add Project
            </Button>
          </>
        }
      >
        {recentProjects.length > 0 ? (
          <ProjectList projects={recentProjects} />
        ) : (
          <EmptyState
            icon={FolderPlus}
            title="还没有项目"
            description="创建一个新的项目目录，或导入一个已存在的本地目录。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setAddOpen(true)}
              >
                Add Project
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="Tasks"
        description="任务状态概览。"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate("tasks")}>
            All Tasks
          </Button>
        }
      >
        {stats.total > 0 ? (
          <div className={styles.taskStats}>
            <button
              type="button"
              className={styles.taskStat}
              onClick={() => navigate("tasks")}
            >
              <span className={`${styles.taskIcon} ${styles.todo}`} aria-hidden="true">
                <CircleDashed size={16} />
              </span>
              <span className={styles.taskCount}>{stats.todo}</span>
              <span className={styles.taskLabel}>待办</span>
            </button>
            <button
              type="button"
              className={styles.taskStat}
              onClick={() => navigate("tasks")}
            >
              <span
                className={`${styles.taskIcon} ${styles.inProgress}`}
                aria-hidden="true"
              >
                <LoaderCircle size={16} />
              </span>
              <span className={styles.taskCount}>{stats.inProgress}</span>
              <span className={styles.taskLabel}>进行中</span>
            </button>
            <button
              type="button"
              className={styles.taskStat}
              onClick={() => navigate("tasks")}
            >
              <span className={`${styles.taskIcon} ${styles.done}`} aria-hidden="true">
                <CheckCircle2 size={16} />
              </span>
              <span className={styles.taskCount}>{stats.done}</span>
              <span className={styles.taskLabel}>已完成</span>
            </button>
          </div>
        ) : (
          <EmptyState
            compact
            icon={ListPlus}
            title="暂无任务"
            description="创建任务来跟踪开发进度。"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("tasks")}
              >
                前往 Tasks
              </Button>
            }
          />
        )}
      </Section>

      <div className={styles.grid}>
        <Section
          title="Development Tools"
          description="已检测到工具的概览入口。"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("tools")}>
              Manage
            </Button>
          }
        >
          {toolSummary.detected.length > 0 ? (
            <ul className={styles.toolList}>
              {toolSummary.detected.slice(0, 4).map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    className={styles.toolRow}
                    onClick={() => navigate("tools")}
                  >
                    <span className={styles.toolIcon} aria-hidden="true">
                      <Wrench size={15} />
                    </span>
                    <span className={styles.toolMain}>
                      <span className={styles.toolName}>
                        {tool.name}
                        {tool.isDefault && " · 默认"}
                      </span>
                      <span className={styles.toolVendor}>
                        {tool.version ?? tool.vendor}
                      </span>
                    </span>
                    <Badge
                      tone={getStatusTone(tool.status)}
                      icon={<CheckCircle2 size={11} aria-hidden="true" />}
                    >
                      {getStatusLabel(tool.status)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={CircleDashed}
              title="尚未检测到工具"
              description="前往 Tools 页面检测本机已安装的 AI 编程工具，或手动添加。"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate("tools")}
                >
                  前往 Tools
                </Button>
              }
            />
          )}
        </Section>

        <Section
          title="Recent Activity"
          description="工作区内的最近操作。"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("activity")}
            >
              View all
            </Button>
          }
        >
          {recentActivity.length > 0 ? (
            <ActivityList items={recentActivity} />
          ) : (
            <EmptyState
              compact
              icon={History}
              title="暂无活动记录"
              description="打开项目、启动工具或创建任务后，记录会显示在这里。"
            />
          )}
        </Section>
      </div>

      <AddProjectDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => navigate("projects")}
      />
    </div>
  );
}
