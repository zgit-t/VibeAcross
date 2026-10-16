import { useMemo, useState } from "react";
import { Plus, RotateCcw, Wrench } from "lucide-react";
import { useProjects } from "../context/ProjectsContext";
import { useTools } from "../context/ToolsContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { PageHeader } from "../components/layout/PageHeader";
import { Section } from "../components/layout/Section";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Notice } from "../components/ui/Notice";
import { SessionDialog } from "../features/workspace/SessionDialog";
import { SessionList } from "../features/workspace/SessionList";
import {
  RESTORE_LEVEL_LABEL,
  RESTORE_LEVEL_TONE,
  SESSION_RESUME_LABEL,
  SESSION_RESUME_TONE,
} from "../features/workspace/meta";
import type { ToolEntry, WorkspaceSession } from "../types/domain";
import styles from "./SessionsPage.module.css";

/** 工作上下文页面：查看、恢复与管理「项目 + 工具 + 任务」组合。 */
export function SessionsPage() {
  const { sessions, loading, error } = useWorkspace();
  const { projects } = useProjects();
  const { tools } = useTools();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceSession | null>(null);

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

  const detectedTools = useMemo(
    () => tools.filter((tool) => tool.installed || tool.isCustom),
    [tools],
  );

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
        title="Sessions"
        description="保存并一键恢复你的工作环境（项目、开发工具与任务）。"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={15} aria-hidden="true" />}
            onClick={openCreate}
            disabled={projects.length === 0}
          >
            Save Context
          </Button>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {projects.length === 0 && (
        <Notice tone="info" title="先创建项目">
          工作上下文需要关联一个项目。请先在 Projects 页面创建或导入项目。
        </Notice>
      )}

      <Section
        title="Saved Contexts"
        description={
          loading
            ? "加载中…"
            : `共 ${sessions.length} 条记录，按最近使用排序。`
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
            title="还没有保存的工作上下文"
            description="保存一个「项目 + 工具 + 任务」组合，之后即可一键恢复工作环境。"
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} aria-hidden="true" />}
                onClick={openCreate}
                disabled={projects.length === 0}
              >
                Save Context
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="恢复能力与限制"
        description="各开发工具实际支持的恢复层级；未经验证的机制不会被标记为可用。"
      >
        {detectedTools.length > 0 ? (
          <ul className={styles.capabilityList}>
            {detectedTools.map((tool) => (
              <li key={tool.id} className={styles.capabilityRow}>
                <div className={styles.capabilityHead}>
                  <span className={styles.capabilityName}>
                    <Wrench size={14} aria-hidden="true" />
                    {tool.name}
                  </span>
                  <Badge tone={RESTORE_LEVEL_TONE[tool.restore.level]}>
                    {RESTORE_LEVEL_LABEL[tool.restore.level]}
                  </Badge>
                  <Badge tone={SESSION_RESUME_TONE[tool.restore.session]}>
                    {SESSION_RESUME_LABEL[tool.restore.session]}
                  </Badge>
                </div>
                <p className={styles.capabilityReason}>{tool.restore.levelReason}</p>
                <p className={styles.capabilityReason}>
                  {tool.restore.sessionReason}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={Wrench}
            title="尚未检测到工具"
            description="前往 Tools 页面检测或手动添加工具后，这里会显示其恢复能力。"
          />
        )}
      </Section>

      <Notice tone="info">
        当前版本实现 Level 1（恢复项目、工作目录与所选工具）。会话恢复（Level 2/3）
        仅在工具提供官方公开机制时标注，且尚未在本机验证，因此不提供对应操作。
      </Notice>

      <SessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        session={editing}
        projectOptions={projectOptions}
      />
    </div>
  );
}
