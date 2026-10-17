import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Section } from "../components/layout/Section";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SessionDialog } from "../features/workspace/SessionDialog";
import { SessionList } from "../features/workspace/SessionList";
import type { ToolEntry, WorkspaceSession } from "../types/domain";
import styles from "./SessionsPage.module.css";

/** 工作上下文页面：查看、恢复与管理「项目 + 工具 + 任务」组合。 */
export function SessionsPage() {
  const { sessions, loading, error } = useWorkspace();
  const { pendingSessionId, clearPendingSession } = useApp();
  const { projects } = useProjects();
  const { tools } = useTools();
  const { t } = useI18n();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSession | null>(null);

  // 消费来自全局搜索等处的上下文深链，打开对应记录的编辑弹窗。
  useEffect(() => {
    if (!pendingSessionId) {
      return;
    }
    const target = sessions.find((session) => session.id === pendingSessionId);
    if (target) {
      setEditing(target);
      setDialogOpen(true);
    }
    clearPendingSession();
  }, [pendingSessionId, sessions, clearPendingSession]);

  const toolById = useMemo(() => {
    const map: Record<string, ToolEntry> = {};
    for (const tool of tools) {
      map[tool.id] = tool;
    }
    return map;
  }, [tools]);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );

  const projectDefaultToolIdByProject = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const project of projects) {
      map[project.id] = project.defaultToolId;
    }
    return map;
  }, [projects]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(session: WorkspaceSession) {
    setEditing(session);
    setDialogOpen(true);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("sessions.title")}
        description={t("sessions.description")}
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={openCreate}
            disabled={projects.length === 0}
          >
            {t("sessions.save")}
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {projects.length === 0 && (
        <Notice tone="info" title={t("sessions.needProjectTitle")}>
          {t("sessions.needProjectBody")}
        </Notice>
      )}

      <Section
        title={t("sessions.savedContexts")}
        description={
          loading
            ? t("common.loading")
            : t("sessions.count", { count: sessions.length })
        }
      >
        {sessions.length > 0 ? (
          <SessionList
            sessions={sessions}
            toolById={toolById}
            tools={tools}
            projectDefaultToolIdByProject={projectDefaultToolIdByProject}
            onEdit={openEdit}
          />
        ) : (
          <EmptyState
            icon={RotateCcw}
            title={t("sessions.emptyTitle")}
            description={t("sessions.emptyDescription")}
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={openCreate}
                disabled={projects.length === 0}
              >
                {t("sessions.save")}
              </Button>
            }
          />
        )}
      </Section>

      <SessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        session={editing}
        projectOptions={projectOptions}
      />
    </div>
  );
}
