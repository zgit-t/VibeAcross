import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, Wrench, X } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useRevision } from "../../context/RevisionContext";
import { useI18n } from "../../i18n";
import { toErrorMessage } from "../../services/backend";
import {
  addProjectTool,
  listProjectTools,
  removeProjectTool,
} from "../../services/projectTools";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { RunSessionFlow } from "./RunSessionFlow";
import type { Project, ProjectTool, ToolEntry } from "../../types/domain";
import styles from "./ProjectSessionSection.module.css";

interface ProjectSessionSectionProps {
  project: Project;
  /** 本机全部工具条目（用于解析关联工具的名称与可用性）。 */
  tools: ToolEntry[];
  /** 项目目录是否可用。 */
  pathHealthy: boolean;
}

/**
 * 项目详情中的「AI 工具与会话」区块。
 *
 * 管理该项目**已关联**的工具（可增可删），并在这些工具中选择该项目的**当前工具**。
 * 当前工具会被持久化（随项目保存、重启后恢复），点击「运行」时直接使用它；
 * 切换当前工具只影响后续运行，不会改变其它工具的会话归属。
 */
export function ProjectSessionSection({
  project,
  tools,
  pathHealthy,
}: ProjectSessionSectionProps) {
  const { t } = useI18n();
  const { navigate } = useApp();
  const { bumpRevision, desktopAvailable, revision } = useRevision();
  const { setProjectTool: persistProjectTool, refresh: refreshProjects } =
    useProjects();

  const [projectTools, setProjectTools] = useState<ProjectTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [addToolId, setAddToolId] = useState("");
  const [flowOpen, setFlowOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ProjectTool | null>(null);
  const loadRef = useRef(0);

  // 关联列表：项目 + 工具（名称 / 可用性）联合展示。
  const associations = useMemo(() => {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    return projectTools.map((pt) => ({ pt, tool: byId.get(pt.toolId) ?? null }));
  }, [projectTools, tools]);

  // 可用于会话的工具：已关联、已检测到（可受控启动）。
  const installedAssociated = useMemo(() => {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    return projectTools
      .map((pt) => byId.get(pt.toolId))
      .filter((tool): tool is ToolEntry => tool != null && tool.installed);
  }, [projectTools, tools]);

  const addable = useMemo(() => {
    const associated = new Set(projectTools.map((pt) => pt.toolId));
    return tools.filter((tool) => tool.installed && !associated.has(tool.id));
  }, [projectTools, tools]);

  // 当前工具来自项目已保存的选择；仅当它仍是「已关联且可用」的工具时才生效。
  const currentToolId = useMemo(() => {
    const saved = project.defaultToolId;
    if (saved && installedAssociated.some((tool) => tool.id === saved)) {
      return saved;
    }
    return null;
  }, [project.defaultToolId, installedAssociated]);

  // 读取关联列表；带请求令牌，丢弃过期结果。
  useEffect(() => {
    if (!desktopAvailable) {
      setProjectTools([]);
      setLoading(false);
      return;
    }
    const token = loadRef.current + 1;
    loadRef.current = token;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await listProjectTools(project.id);
        if (cancelled || loadRef.current !== token) {
          return;
        }
        setProjectTools(list);
        setError(null);
      } catch (cause) {
        if (cancelled || loadRef.current !== token) {
          return;
        }
        setError(toErrorMessage(cause, t("projectTools.loadFailed")));
      } finally {
        if (!cancelled && loadRef.current === token) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, reloadKey, revision, desktopAvailable, t]);

  async function handleAdd() {
    if (!addToolId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addProjectTool(project.id, addToolId);
      setAddToolId("");
      setReloadKey((key) => key + 1);
      // 关联新工具即成为当前工具（后端已写入），刷新项目以同步选择器。
      await refreshProjects();
      bumpRevision();
    } catch (cause) {
      setError(toErrorMessage(cause, t("projectTools.addFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!confirmRemove) {
      return;
    }
    const target = confirmRemove;
    setBusy(true);
    setError(null);
    try {
      await removeProjectTool(target.id);
      setConfirmRemove(null);
      setFlowOpen(false);
      setReloadKey((key) => key + 1);
      bumpRevision();
    } catch (cause) {
      setError(toErrorMessage(cause, t("projectTools.removeFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectCurrentTool(toolId: string) {
    if (!toolId || toolId === currentToolId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 持久化为项目的当前工具（后端会同时确保该工具处于关联状态）。
      await persistProjectTool(project.id, toolId);
    } catch (cause) {
      setError(toErrorMessage(cause, t("projectTools.switchFailed")));
    } finally {
      setBusy(false);
    }
  }

  const currentToolOptions = useMemo(() => {
    const options = installedAssociated.map((tool) => ({
      value: tool.id,
      label: tool.name,
    }));
    if (!currentToolId) {
      options.unshift({ value: "", label: t("projectTools.currentNone") });
    }
    return options;
  }, [installedAssociated, currentToolId, t]);

  const addOptions = useMemo(
    () =>
      addable.length === 0
        ? [{ value: "", label: t("projectTools.addNone") }]
        : addable.map((tool) => ({ value: tool.id, label: tool.name })),
    [addable, t],
  );

  return (
    <>
      <section className={styles.section}>
        <span className={styles.label}>{t("projectTools.sectionTitle")}</span>
        <p className={styles.hint}>{t("projectTools.description")}</p>

        {error && <Notice tone="danger">{error}</Notice>}

        {loading ? (
          <p className={styles.hint}>{t("common.loading")}</p>
        ) : (
          <>
            {projectTools.length === 0 ? (
              <p className={styles.hint}>{t("projectTools.noTools")}</p>
            ) : (
              <ul className={styles.list}>
                {associations.map(({ pt, tool }) => (
                  <li key={pt.id} className={styles.item}>
                    <span className={styles.itemName} title={tool?.name}>
                      {tool?.name ?? t("projectDetail.toolRemoved")}
                    </span>
                    <span className={styles.itemMeta}>
                      {t("projectTools.sessionCount", { count: pt.sessionCount })}
                    </span>
                    {tool && !tool.installed && (
                      <Badge tone="warning">{t("toolStatus.pathMissing")}</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<X size={14} aria-hidden="true" />}
                      onClick={() => setConfirmRemove(pt)}
                      disabled={busy}
                    >
                      {t("projectTools.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {tools.filter((tool) => tool.installed).length === 0 ? (
              <div className={styles.inlineEnd}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Wrench size={14} aria-hidden="true" />}
                  onClick={() => navigate("tools")}
                >
                  {t("projectTools.goTools")}
                </Button>
              </div>
            ) : (
              <div className={styles.addRow}>
                <SelectField
                  label={t("projectTools.addLabel")}
                  options={addOptions}
                  value={addToolId}
                  onChange={(event) => setAddToolId(event.target.value)}
                  disabled={busy || addable.length === 0}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={handleAdd}
                  disabled={busy || !addToolId}
                >
                  {t("projectTools.add")}
                </Button>
              </div>
            )}

            {installedAssociated.length > 0 && (
              <>
                <SelectField
                  label={t("projectTools.currentLabel")}
                  options={currentToolOptions}
                  value={currentToolId ?? ""}
                  onChange={(event) =>
                    void handleSelectCurrentTool(event.target.value)
                  }
                  disabled={busy}
                />
                <div className={styles.runRow}>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={14} aria-hidden="true" />}
                    onClick={() => setFlowOpen(true)}
                    disabled={busy || !pathHealthy || !currentToolId}
                  >
                    {t("projectTools.run")}
                  </Button>
                  {!currentToolId && (
                    <span className={styles.hint}>
                      {t("projectTools.currentRequired")}
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>

      <RunSessionFlow
        open={flowOpen}
        project={project}
        initialToolId={currentToolId}
        onClose={() => setFlowOpen(false)}
        onToolChange={handleSelectCurrentTool}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title={t("projectTools.removeTitle")}
        description={
          confirmRemove
            ? t("projectTools.removeBody", {
                tool:
                  associations.find((item) => item.pt.id === confirmRemove.id)
                    ?.tool?.name ?? t("projectDetail.toolRemoved"),
                project: project.name,
                count: confirmRemove.sessionCount,
              })
            : undefined
        }
        confirmLabel={t("common.remove")}
        tone="danger"
        busy={busy}
        onConfirm={handleRemove}
        onClose={() => setConfirmRemove(null)}
      />
    </>
  );
}
