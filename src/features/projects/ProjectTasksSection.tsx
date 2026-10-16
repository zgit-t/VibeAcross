import { useMemo, useState } from "react";
import { ListPlus, Plus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Notice } from "../../components/ui/Notice";
import { useTaskList } from "../../context/TasksContext";
import { useI18n } from "../../i18n";
import { TaskDialog } from "../tasks/TaskDialog";
import { TaskList } from "../tasks/TaskList";
import type { Task } from "../../types/domain";
import styles from "./ProjectTasksSection.module.css";

interface ProjectTasksSectionProps {
  projectId: string;
  projectName: string;
}

/** 项目详情中的任务区块：查看与管理该项目的任务。 */
export function ProjectTasksSection({
  projectId,
  projectName,
}: ProjectTasksSectionProps) {
  const query = useMemo(
    () => ({ projectId, sort: "updated" as const }),
    [projectId],
  );
  const { tasks, loading, error } = useTaskList(query);
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const projectNameById = useMemo(
    () => ({ [projectId]: projectName }),
    [projectId, projectName],
  );

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <span className={styles.label}>
          {!loading && tasks.length > 0
            ? t("projectTasks.labelCount", { count: tasks.length })
            : t("projectTasks.label")}
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t("projectTasks.newTask")}
        </Button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className={styles.listWrap}>
        {tasks.length > 0 ? (
          <TaskList
            tasks={tasks}
            projectNameById={projectNameById}
            onEdit={(task) => {
              setEditing(task);
              setDialogOpen(true);
            }}
          />
        ) : loading ? null : (
          <EmptyState
            compact
            icon={ListPlus}
            title={t("projectTasks.emptyTitle")}
            description={t("projectTasks.emptyDescription")}
          />
        )}
      </div>

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editing}
        defaultProjectId={projectId}
        projectOptions={[{ id: projectId, name: projectName }]}
      />
    </section>
  );
}
