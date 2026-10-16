import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FolderPlus,
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
import { useWorkspace } from "../context/WorkspaceContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Section } from "../components/layout/Section";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Notice } from "../components/ui/Notice";
import { ProjectList } from "../features/projects/ProjectList";
import { AddProjectDialog } from "../features/projects/AddProjectDialog";
import { TOOL_STATUS_KEY, getStatusTone } from "../features/tools/data";
import { RESTORE_LEVEL_KEY, RESTORE_LEVEL_TONE, sessionName } from "../features/workspace/meta";
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
  const { navigate, openProject, showLastContextOnStartup } = useApp();
  const { projects } = useProjects();
  const { tools } = useTools();
  const { t } = useI18n();
  const stats = useTaskStats();
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
      setResumeError(toErrorMessage(cause, t("overview.resume.error")));
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
        title={t("overview.title")}
        description={t("overview.description")}
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
              ? t("overview.autoRestore.running")
              : autoRestore.state === "success"
                ? t("overview.autoRestore.success")
                : t("overview.autoRestore.failed")
          }
        >
          <div className={styles.bannerBody}>
            <span>
              {autoRestore.message ?? t("overview.autoRestore.defaultMessage")}
            </span>
            <Button variant="ghost" size="sm" onClick={dismissAutoRestore}>
              {t("common.gotIt")}
            </Button>
          </div>
        </Notice>
      )}

      {showLastContextOnStartup && (
        <Section
          title={t("overview.resume.title")}
          description={t("overview.resume.description")}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("sessions")}
            >
              {t("overview.resume.allSessions")}
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
                    {t(RESTORE_LEVEL_KEY[lastSession.restoreLevel])}
                  </Badge>
                </div>
                <div className={styles.resumeMeta}>
                  <span>
                    {lastSession.projectName ?? t("overview.resume.projectDeleted")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{lastSession.toolName ?? t("overview.resume.noTool")}</span>
                  {lastSession.taskTitle && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("overview.resume.task", { title: lastSession.taskTitle })}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {t("overview.resume.lastUsed", {
                      time: formatRelativeTime(lastSession.lastUsedAt),
                    })}
                  </span>
                </div>
                {lastSession.lastRestoreStatus === "failed" &&
                  lastSession.lastRestoreError && (
                    <p className={styles.resumeError}>
                      {t("overview.resume.lastFailed", {
                        reason: lastSession.lastRestoreError,
                      })}
                    </p>
                  )}
              </div>
              <Button
                variant="primary"
                icon={<Play size={15} aria-hidden="true" />}
                disabled={resumeBusy || !desktopAvailable}
                onClick={() => void handleResume(lastSession.id)}
              >
                {resumeBusy
                  ? t("overview.resume.restoring")
                  : t("overview.resume.restore")}
              </Button>
            </div>
          ) : (
            <EmptyState
              compact
              icon={RotateCcw}
              title={t("overview.resume.emptyTitle")}
              description={t("overview.resume.emptyDescription")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate("sessions")}
                >
                  {t("overview.resume.goSessions")}
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
      )}

      <Section
        title={t("overview.recentProjects.title")}
        description={t("overview.recentProjects.description")}
        action={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("projects")}
            >
              {t("overview.recentProjects.allProjects")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={15} aria-hidden="true" />}
              onClick={() => setAddOpen(true)}
            >
              {t("overview.recentProjects.addProject")}
            </Button>
          </>
        }
      >
        {recentProjects.length > 0 ? (
          <ProjectList
            projects={recentProjects}
            onSelect={(project) => openProject(project.id)}
          />
        ) : (
          <EmptyState
            icon={FolderPlus}
            title={t("overview.recentProjects.emptyTitle")}
            description={t("overview.recentProjects.emptyDescription")}
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={() => setAddOpen(true)}
              >
                {t("overview.recentProjects.addProject")}
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title={t("overview.tasks.title")}
        description={t("overview.tasks.description")}
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate("tasks")}>
            {t("overview.tasks.allTasks")}
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
              <span className={styles.taskLabel}>{t("taskStatus.todo")}</span>
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
              <span className={styles.taskLabel}>{t("taskStatus.inProgress")}</span>
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
              <span className={styles.taskLabel}>{t("taskStatus.done")}</span>
            </button>
          </div>
        ) : (
          <EmptyState
            compact
            icon={ListPlus}
            title={t("overview.tasks.emptyTitle")}
            description={t("overview.tasks.emptyDescription")}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("tasks")}
              >
                {t("overview.tasks.goTasks")}
              </Button>
            }
          />
        )}
      </Section>

      <div className={styles.grid}>
        <Section
          title={t("overview.tools.title")}
          description={t("overview.tools.description")}
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("tools")}>
              {t("overview.tools.manage")}
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
                        {tool.isDefault && t("overview.tools.defaultSuffix")}
                      </span>
                      <span className={styles.toolVendor}>
                        {tool.version ?? tool.vendor}
                      </span>
                    </span>
                    <Badge
                      tone={getStatusTone(tool.status)}
                      icon={<CheckCircle2 size={11} aria-hidden="true" />}
                    >
                      {t(TOOL_STATUS_KEY[tool.status])}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={CircleDashed}
              title={t("overview.tools.emptyTitle")}
              description={t("overview.tools.emptyDescription")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate("tools")}
                >
                  {t("overview.tools.goTools")}
                </Button>
              }
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
