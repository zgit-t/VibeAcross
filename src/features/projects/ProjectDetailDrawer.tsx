import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderSearch,
  Play,
  Star,
  StarOff,
  Trash2,
  Wrench,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useTools } from "../../context/ToolsContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Drawer } from "../../components/ui/Drawer";
import { Notice } from "../../components/ui/Notice";
import { SelectField } from "../../components/ui/SelectField";
import { pickDirectory } from "../../services/dialog";
import { toErrorMessage } from "../../services/backend";
import {
  LAUNCH_METHOD_LABEL,
  LAUNCH_SUPPORT_LABEL,
  LAUNCH_SUPPORT_TONE,
} from "../tools/data";
import { formatDateTime } from "../../utils/format";
import { ProjectTasksSection } from "./ProjectTasksSection";
import type { Project } from "../../types/domain";
import styles from "./ProjectDetailDrawer.module.css";

interface ProjectDetailDrawerProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

/** 项目详情抽屉：重命名、编辑备注、收藏、重新定位与移除。 */
export function ProjectDetailDrawer({
  project,
  open,
  onClose,
}: ProjectDetailDrawerProps) {
  const {
    renameProject,
    updateDescription,
    setFavorite,
    relocate,
    remove,
    setProjectTool,
    launchProject,
  } = useProjects();
  const { tools } = useTools();
  const { navigate } = useApp();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const syncedIdRef = useRef<string | null>(null);

  // 只有「已检测到」的工具可以关联为项目默认工具。
  const installedTools = useMemo(
    () => tools.filter((tool) => tool.installed),
    [tools],
  );
  const selectedTool = project?.defaultToolId
    ? tools.find((tool) => tool.id === project.defaultToolId) ?? null
    : null;

  const toolOptions = useMemo(() => {
    const options = installedTools.map((tool) => ({
      value: tool.id,
      label: tool.name,
    }));
    if (
      project?.defaultToolId &&
      !options.some((option) => option.value === project.defaultToolId)
    ) {
      const found = tools.find((tool) => tool.id === project.defaultToolId);
      options.unshift({
        value: project.defaultToolId,
        label: found ? `${found.name}（当前不可用）` : "（已移除的工具）",
      });
    }
    return [{ value: "", label: "未选择工具" }, ...options];
  }, [installedTools, tools, project?.defaultToolId]);

  // 仅在抽屉「打开某个项目」时载入草稿，避免列表刷新覆盖用户正在编辑的内容。
  useEffect(() => {
    if (!open || !project) {
      if (!open) {
        syncedIdRef.current = null;
      }
      return;
    }
    if (syncedIdRef.current === project.id) {
      return;
    }
    syncedIdRef.current = project.id;
    setName(project.name);
    setDescription(project.description ?? "");
    setError(null);
    setLaunchNotice(null);
    setConfirmRemove(false);
  }, [open, project]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(toErrorMessage(cause, "操作失败。"));
    } finally {
      setBusy(false);
    }
  }

  function handleRename() {
    if (!project) {
      return;
    }
    if (!name.trim()) {
      setError("项目名称不能为空。");
      return;
    }
    if (name.trim() === project.name) {
      return;
    }
    void run(() => renameProject(project.id, name.trim()));
  }

  function handleSaveDescription() {
    if (!project) {
      return;
    }
    const next = description.trim();
    void run(() => updateDescription(project.id, next ? next : null));
  }

  function handleToggleFavorite() {
    if (!project) {
      return;
    }
    void run(() => setFavorite(project.id, !project.isFavorite));
  }

  function handleSetTool(toolId: string | null) {
    if (!project) {
      return;
    }
    setLaunchNotice(null);
    void run(() => setProjectTool(project.id, toolId));
  }

  async function handleLaunch() {
    if (!project || !project.defaultToolId) {
      return;
    }
    setLaunching(true);
    setError(null);
    setLaunchNotice(null);
    try {
      const result = await launchProject(project.id, project.defaultToolId);
      setLaunchNotice(`已启动 ${result.toolName}（PID ${result.pid}）。`);
    } catch (cause) {
      setError(toErrorMessage(cause, "启动工具失败。"));
    } finally {
      setLaunching(false);
    }
  }

  async function handleRelocate() {
    if (!project) {
      return;
    }
    const selected = await pickDirectory({ defaultPath: project.path });
    if (!selected) {
      return;
    }
    await run(() => relocate(project.id, selected));
  }

  function handleRemove() {
    if (!project) {
      return;
    }
    void run(async () => {
      await remove(project.id);
      setConfirmRemove(false);
      onClose();
    });
  }

  return (
    <>
      <Drawer
        open={open}
        title={project?.name ?? "项目详情"}
        subtitle={project?.path}
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        }
      >
        {project && (
          <>
            {!project.pathExists && (
              <Notice tone="warning" title="目录不可用">
                该项目目录当前不存在，可能已被移动或删除。请在磁盘上找回后使用「重新定位」。
              </Notice>
            )}

            {error && <Notice tone="danger">{error}</Notice>}

            <section className={styles.section}>
              <span className={styles.label}>名称</span>
              <div className={styles.inline}>
                <input
                  className={styles.input}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="项目名称"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRename}
                  disabled={busy}
                >
                  保存
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>备注</span>
              <textarea
                className={styles.textarea}
                value={description}
                placeholder="添加备注，帮助识别这个项目…"
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                aria-label="项目备注"
              />
              <div className={styles.inlineEnd}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSaveDescription}
                  disabled={busy}
                >
                  保存备注
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>路径</span>
              <code className={styles.path}>{project.path}</code>
              <div className={styles.inlineEnd}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FolderSearch size={14} aria-hidden="true" />}
                  onClick={handleRelocate}
                  disabled={busy}
                >
                  重新定位…
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>收藏</span>
              <div className={styles.inline}>
                <Button
                  variant={project.isFavorite ? "primary" : "secondary"}
                  size="sm"
                  icon={
                    project.isFavorite ? (
                      <Star size={14} aria-hidden="true" />
                    ) : (
                      <StarOff size={14} aria-hidden="true" />
                    )
                  }
                  onClick={handleToggleFavorite}
                  disabled={busy}
                >
                  {project.isFavorite ? "已收藏" : "加入收藏"}
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <span className={styles.label}>开发工具</span>

              {installedTools.length === 0 ? (
                <>
                  <p className={styles.hint}>
                    还没有可用（已检测到）的开发工具，请先在 Tools 页面检测或添加。
                  </p>
                  <div className={styles.inlineEnd}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Wrench size={14} aria-hidden="true" />}
                      onClick={() => navigate("tools")}
                    >
                      前往 Tools 配置
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <SelectField
                    label="默认开发工具"
                    options={toolOptions}
                    value={project.defaultToolId ?? ""}
                    onChange={(event) =>
                      handleSetTool(event.target.value || null)
                    }
                    disabled={busy}
                    hint="保存后会记录为该项目的默认工具。"
                  />

                  {selectedTool && (
                    <div className={styles.launchStatus}>
                      <Badge
                        tone={LAUNCH_SUPPORT_TONE[selectedTool.launch.support]}
                      >
                        {LAUNCH_SUPPORT_LABEL[selectedTool.launch.support]}
                      </Badge>
                      {selectedTool.launch.method && (
                        <span className={styles.launchMethod}>
                          {LAUNCH_METHOD_LABEL[selectedTool.launch.method]}
                        </span>
                      )}
                    </div>
                  )}

                  {selectedTool &&
                    selectedTool.launch.support !== "supported" && (
                      <p className={styles.hint}>{selectedTool.launch.reason}</p>
                    )}

                  {launchNotice && (
                    <Notice tone="success">{launchNotice}</Notice>
                  )}

                  <div className={styles.inlineEnd}>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Play size={14} aria-hidden="true" />}
                      onClick={handleLaunch}
                      disabled={
                        busy ||
                        launching ||
                        !selectedTool ||
                        selectedTool.launch.support !== "supported" ||
                        !project.pathExists
                      }
                    >
                      启动工具
                    </Button>
                  </div>
                </>
              )}
            </section>

            <ProjectTasksSection
              projectId={project.id}
              projectName={project.name}
            />

            <section className={styles.section}>
              <span className={styles.label}>信息</span>
              <dl className={styles.meta}>
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatDateTime(project.createdAt)}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{formatDateTime(project.updatedAt)}</dd>
                </div>
                <div>
                  <dt>最近访问</dt>
                  <dd>{formatDateTime(project.lastOpenedAt)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.danger}>
              <span className={styles.label}>危险操作</span>
              <p className={styles.dangerHint}>
                移除后仅从 VibeAcross 中删除记录，不会删除磁盘上的项目目录。
              </p>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
              >
                移除项目
              </Button>
            </section>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmRemove}
        title="移除项目？"
        description={
          project ? `将从列表中移除「${project.name}」，磁盘目录保持不动。` : undefined
        }
        confirmLabel="移除"
        tone="danger"
        busy={busy}
        onConfirm={handleRemove}
        onClose={() => setConfirmRemove(false)}
      />
    </>
  );
}
