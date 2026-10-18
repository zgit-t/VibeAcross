import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  History,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useI18n } from "../../i18n";
import { useRevision } from "../../context/RevisionContext";
import { isBackendError, toErrorMessage } from "../../services/backend";
import { launchProject } from "../../services/projects";
import {
  createNativeSession,
  deleteSessionScoped,
  listSessions,
  renameNativeSession,
  restoreNativeSession,
  sessionCapabilities,
  syncNativeSessions,
} from "../../services/sessions";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { RadioGroup } from "../../components/ui/RadioGroup";
import type { RadioOption } from "../../components/ui/RadioGroup";
import { SelectField } from "../../components/ui/SelectField";
import { TextField } from "../../components/ui/TextField";
import { formatRelativeTime } from "../../utils/format";
import {
  HISTORY_STATE_DESC_KEY,
  HISTORY_STATE_KEY,
  HISTORY_STATE_TONE,
  aiSessionName,
  getAiSessionState,
} from "./meta";
import type {
  Project,
  ToolEntry,
  AiSession,
  DeleteScope,
  HistoryQueryState,
  NativeSessionCapabilities,
  SessionDeleteOutcome,
} from "../../types/domain";
import styles from "./RunSessionDialog.module.css";

interface RunSessionDialogProps {
  open: boolean;
  project: Project | null;
  /** 该项目已关联、且当前可用的工具（安装条目），顺序稳定。 */
  tools: ToolEntry[];
  /** 关联工具是否仍在加载（用于区分「加载中」与「确实没有工具」）。 */
  toolsLoading?: boolean;
  /** 打开时默认选中的工具安装 id。 */
  initialToolId: string | null;
  /** 打开时的初始视图：默认历史列表，可按入口要求直接进入新建表单。 */
  initialMode?: "list" | "create";
  onClose: () => void;
  /** 用户在弹窗内切换工具时回调（用于记住当前运行工具）。 */
  onToolChange?: (toolId: string) => void;
}

interface DialogNotice {
  tone: "success" | "warning";
  title: string;
}

/** 一次历史会话读取的完整结果（能力 + 列表 + 来源状态）。 */
interface HistorySnapshot {
  capabilities: NativeSessionCapabilities;
  sessions: AiSession[];
  state: HistoryQueryState | null;
}

/**
 * 运行会话弹窗：在当前项目 + 所选工具下，列出历史会话、创建新会话或恢复指定会话。
 *
 * 关键约束：
 *  - 只展示当前项目 + 所选工具的历史会话；切换工具立即重新加载；
 *  - 仅在工具如实支持时才提供创建 / 恢复操作；
 *  - 后端确认创建 / 恢复成功后，才显示成功状态；
 *  - 删除前必须二次确认；工具已核实支持时先删除工具中的原生会话再清理本地记录，
 *    否则明确告知用户「仅删除本地记录、工具中的会话保留」，绝不静默退化。
 */
export function RunSessionDialog({
  open,
  project,
  tools,
  toolsLoading = false,
  initialToolId,
  initialMode = "list",
  onClose,
  onToolChange,
}: RunSessionDialogProps) {
  const { t } = useI18n();
  const { bumpRevision } = useRevision();

  const projectId = project?.id ?? null;
  const pathExists = project?.pathExists ?? false;
  const [toolId, setToolId] = useState<string | null>(initialToolId);
  const [capabilities, setCapabilities] =
    useState<NativeSessionCapabilities | null>(null);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [historyState, setHistoryState] = useState<HistoryQueryState | null>(
    null,
  );
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DialogNotice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSyncNative, setEditSyncNative] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [markedMissing, setMarkedMissing] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AiSession | null>(null);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("local");
  const requestRef = useRef(0);
  // 同一「项目 + 工具 + 刷新批次」的并发读取去重：命中在途请求则复用其 Promise，
  // 避免因重复渲染 / StrictMode 二次挂载等触发重复查询。
  const inflightRef = useRef(new Map<string, Promise<HistorySnapshot>>());

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === toolId) ?? null,
    [tools, toolId],
  );

  const anyBusy = creating || opening || busyId !== null;

  // 打开弹窗（或切换项目）时重置全部瞬时状态，并采用传入的初始工具。
  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setToolId(initialToolId ?? tools[0]?.id ?? null);
    setCapabilities(null);
    setSessions([]);
    setHistoryState(null);
    setOpening(false);
    setLoading(false);
    setLoaded(false);
    setError(null);
    setNotice(null);
    setCreating(false);
    setMode(initialMode);
    setNewName("");
    setCreateError(null);
    setBusyId(null);
    setEditingId(null);
    setEditName("");
    setEditSyncNative(false);
    setEditError(null);
    setMarkedMissing(new Set());
    setConfirmDelete(null);
    setDeleteScope("local");
    // 仅在打开 / 切换项目时重置；工具与初始工具从最新 props 读取即可。
  }, [open, projectId]);

  // 关联工具异步到达后补选当前工具（打开瞬间工具列表可能尚未加载完成）。
  useEffect(() => {
    if (!open) {
      return;
    }
    if (toolId && tools.some((entry) => entry.id === toolId)) {
      return;
    }
    const next =
      initialToolId && tools.some((entry) => entry.id === initialToolId)
        ? initialToolId
        : tools[0]?.id ?? null;
    if (next !== toolId) {
      setToolId(next);
    }
  }, [open, tools, initialToolId, toolId]);

  // 加载能力与历史会话；带请求令牌，丢弃过期结果（切换工具 / 关闭后不覆盖新状态）。
  // 同一查询进行中时复用同一 Promise，避免重复触发（例如重复渲染 / StrictMode）。
  useEffect(() => {
    if (!open || !projectId || !toolId || !pathExists) {
      setLoading(false);
      return;
    }
    const tool = tools.find((entry) => entry.id === toolId);
    if (!tool) {
      setError(t("aiSession.toolUnavailable"));
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setNotice(null);
    setEditingId(null);

    const key = `${projectId}|${toolId}|${tool.toolId}|${reloadKey}`;
    let request = inflightRef.current.get(key);
    if (!request) {
      request = (async (): Promise<HistorySnapshot> => {
        const caps = await sessionCapabilities(tool.toolId);
        let list: AiSession[];
        let state: HistoryQueryState | null = null;
        if (caps.list === "supported") {
          const outcome = await syncNativeSessions(projectId, toolId);
          list = outcome.sessions;
          state = outcome.state;
        } else {
          list = await listSessions({ projectId, toolId });
        }
        return { capabilities: caps, sessions: list, state };
      })();
      inflightRef.current.set(key, request);
      const cleanup = () => {
        if (inflightRef.current.get(key) === request) {
          inflightRef.current.delete(key);
        }
      };
      void request.then(cleanup, cleanup);
    }

    void request
      .then((snapshot) => {
        if (cancelled || requestRef.current !== token) {
          return;
        }
        setCapabilities(snapshot.capabilities);
        setSessions(snapshot.sessions);
        setHistoryState(snapshot.state);
        setMarkedMissing(new Set());
        setLoaded(true);
      })
      .catch((cause) => {
        if (cancelled || requestRef.current !== token) {
          return;
        }
        setError(toErrorMessage(cause, t("aiSession.loadFailed")));
        setLoaded(true);
      })
      .finally(() => {
        if (!cancelled && requestRef.current === token) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, pathExists, toolId, reloadKey, tools, t]);

  function handleToolSwitch(next: string) {
    if (next === toolId) {
      return;
    }
    setToolId(next);
    setMode("list");
    onToolChange?.(next);
  }

  async function handleOpenTool() {
    if (!projectId || !toolId) {
      return;
    }
    setOpening(true);
    setError(null);
    setNotice(null);
    try {
      // 只做「在项目目录中打开该工具」，绝不冒充新建 / 恢复会话。
      const result = await launchProject(projectId, toolId);
      bumpRevision();
      setNotice({
        tone: "success",
        title: t("aiSession.openToolSuccess", { tool: result.toolName }),
      });
    } catch (cause) {
      setError(toErrorMessage(cause, t("aiSession.openToolFailed")));
    } finally {
      setOpening(false);
    }
  }

  async function handleCreate() {
    if (!projectId || !toolId) {
      return;
    }
    const name = newName.trim();
    if (name.length > 120) {
      setCreateError(t("aiSession.nameTooLong"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    setError(null);
    setNotice(null);
    try {
      const outcome = await createNativeSession({
        projectId,
        toolId,
        displayName: name ? name : null,
        launch: true,
      });
      bumpRevision();
      if (outcome.launchError) {
        // 会话已真实创建，但启动失败：如实报告，并刷新列表。
        setMode("list");
        setNewName("");
        setNotice({
          tone: "warning",
          title: t("aiSession.successCreatedNoLaunch", {
            name: outcome.session.displayName,
            reason: outcome.launchError.message,
          }),
        });
        setReloadKey((key) => key + 1);
      } else {
        setNotice({
          tone: "success",
          title: t("aiSession.successCreated", {
            name: outcome.session.displayName,
          }),
        });
        onClose();
      }
    } catch (cause) {
      setCreateError(toErrorMessage(cause, t("aiSession.createFailed")));
    } finally {
      setCreating(false);
    }
  }

  async function handleRestore(session: AiSession) {
    setBusyId(session.id);
    setError(null);
    setNotice(null);
    try {
      await restoreNativeSession(session.id);
      bumpRevision();
      setNotice({
        tone: "success",
        title: t("aiSession.successRestored", {
          name: aiSessionName(session),
        }),
      });
      onClose();
    } catch (cause) {
      if (isBackendError(cause) && cause.code === "NATIVE_SESSION_MISSING") {
        setMarkedMissing((prev) => new Set(prev).add(session.id));
      }
      setError(toErrorMessage(cause, t("aiSession.restoreFailed")));
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(session: AiSession) {
    setEditingId(session.id);
    setEditName(session.displayName);
    setEditSyncNative(false);
    setEditError(null);
  }

  async function handleRename(session: AiSession) {
    const name = editName.trim();
    if (!name) {
      setEditError(t("aiSession.nameEmpty"));
      return;
    }
    if (name.length > 120) {
      setEditError(t("aiSession.nameTooLong"));
      return;
    }
    setBusyId(session.id);
    setEditError(null);
    try {
      const outcome = await renameNativeSession(
        session.id,
        name,
        editSyncNative,
      );
      bumpRevision();
      setSessions((prev) =>
        prev.map((item) => (item.id === session.id ? outcome.session : item)),
      );
      setEditingId(null);
    } catch (cause) {
      // 保留输入，展示可理解的错误。
      setEditError(toErrorMessage(cause, t("aiSession.renameFailed")));
    } finally {
      setBusyId(null);
    }
  }

  // 是否可删除原生会话：工具已核实支持删除，且该记录确有原生标识。
  function canDeleteNative(session: AiSession): boolean {
    return capabilities?.delete === "supported" && session.nativeSessionId != null;
  }

  // 原生删除不可用时的原因（用于禁用「仅原生 / 两者」选项）。
  function nativeDeleteBlockReason(session: AiSession): string {
    if (session.nativeSessionId == null) {
      return t("aiSession.deleteScopeNoNativeId");
    }
    return t("aiSession.deleteScopeNativeUnsupported", {
      tool: session.toolName ?? selectedTool?.name ?? "",
    });
  }

  // 删除范围选项：默认「仅本地记录」（风险最低）；原生相关选项在不可用时禁用并说明原因。
  function deleteScopeOptions(session: AiSession): RadioOption<DeleteScope>[] {
    const nativeAvailable = canDeleteNative(session);
    const blockReason = nativeAvailable
      ? undefined
      : nativeDeleteBlockReason(session);
    return [
      {
        value: "local",
        label: t("aiSession.deleteScopeLocal"),
        description: t("aiSession.deleteScopeLocalDesc"),
      },
      {
        value: "native",
        label: t("aiSession.deleteScopeNative"),
        description: t("aiSession.deleteScopeNativeDesc"),
        note: t("aiSession.deleteScopeNativeNote"),
        disabled: !nativeAvailable,
        disabledReason: blockReason,
      },
      {
        value: "both",
        label: t("aiSession.deleteScopeBoth"),
        description: t("aiSession.deleteScopeBothDesc"),
        note: t("aiSession.deleteScopeBothNote"),
        disabled: !nativeAvailable,
        disabledReason: blockReason,
      },
    ];
  }

  // 按实际结果如实提示（仅本地 / 仅原生 / 两者）。
  function deleteNotice(
    outcome: SessionDeleteOutcome,
    name: string,
  ): DialogNotice {
    if (outcome.scope === "local") {
      return { tone: "success", title: t("aiSession.deletedLocalOnly", { name }) };
    }
    if (outcome.scope === "native") {
      return {
        tone: outcome.nativeAlreadyGone ? "warning" : "success",
        title: outcome.nativeAlreadyGone
          ? t("aiSession.deleteNativeAlreadyGoneOnly", { name })
          : t("aiSession.deletedNativeOnly", { name }),
      };
    }
    return {
      tone: outcome.nativeAlreadyGone ? "warning" : "success",
      title: outcome.nativeAlreadyGone
        ? t("aiSession.deletedBothNativeAlreadyGone", { name })
        : t("aiSession.deletedWithNative", { name }),
    };
  }

  async function handleDelete() {
    if (!confirmDelete) {
      return;
    }
    const target = confirmDelete;
    const name = aiSessionName(target);
    setBusyId(target.id);
    setError(null);
    setNotice(null);
    try {
      // 范围与执行顺序由后端协调；任何失败都会如实报错，本地记录不会被误删。
      const outcome = await deleteSessionScoped(target.id, deleteScope);
      bumpRevision();
      if (outcome.localDeleted) {
        // 本地记录已清理 → 从当前列表移除。
        setSessions((prev) => prev.filter((item) => item.id !== target.id));
      } else {
        // 仅删除原生会话：本地记录保留，标记为原生会话已不存在。
        setMarkedMissing((prev) => new Set(prev).add(target.id));
      }
      setConfirmDelete(null);
      setNotice(deleteNotice(outcome, name));
    } catch (cause) {
      setError(toErrorMessage(cause, t("aiSession.deleteFailed")));
    } finally {
      setBusyId(null);
    }
  }

  const canCreate = capabilities?.create === "supported";
  const canSyncNative = capabilities?.renameTitle === "supported";
  const listUnsupported = capabilities != null && capabilities.list !== "supported";
  const launchSupport = selectedTool?.launch.support ?? "unavailable";
  const canOpenTool = launchSupport === "supported";

  // 是否会真正发起历史会话读取：用于在首帧就显示加载态，避免空状态一闪而过。
  const expectsHistoryLoad =
    open && projectId != null && pathExists && tools.length > 0;
  // 加载动画条件：正在加载，或尚未完成首次读取（且确实会读取、且未报错）。
  const showLoading = loading || (!loaded && expectsHistoryLoad && !error);

  const toolOptions = useMemo(
    () => tools.map((tool) => ({ value: tool.id, label: tool.name })),
    [tools],
  );

  return (
    <>
      <Modal
        open={open}
        title={t("aiSession.title")}
        description={
          project
            ? t("aiSession.description", {
                project: project.name,
                tool: selectedTool?.name ?? t("projectList.noTool"),
              })
            : undefined
        }
        size="lg"
        onClose={anyBusy ? () => undefined : onClose}
        footer={
          <Button variant="secondary" onClick={onClose} disabled={anyBusy}>
            {t("common.close")}
          </Button>
        }
      >
        {project && (
          <div className={styles.body}>
            {toolsLoading && tools.length === 0 ? (
              <LoadingState label={t("tools.loading")} />
            ) : tools.length === 0 ? (
              <Notice tone="warning" title={t("aiSession.noToolsTitle")}>
                {t("aiSession.noTools")}
              </Notice>
            ) : (
              <>
                {tools.length > 1 && (
                  <SelectField
                    label={t("aiSession.toolLabel")}
                    options={toolOptions}
                    value={toolId ?? ""}
                    onChange={(event) => handleToolSwitch(event.target.value)}
                    disabled={anyBusy}
                  />
                )}

                {!project.pathExists && (
                  <Notice tone="danger">
                    {t("aiSession.projectDirInvalid")}
                  </Notice>
                )}

                {listUnsupported && (
                  <Notice
                    tone="warning"
                    title={t("aiSession.unsupportedTitle")}
                  >
                    {t("aiSession.unsupportedBody", {
                      tool: selectedTool?.name ?? "",
                    })}
                  </Notice>
                )}

                {capabilities != null && !canCreate && (
                  <Notice tone="info">
                    {t("aiSession.createUnsupportedTitle")}
                  </Notice>
                )}

                {notice && (
                  <Notice tone={notice.tone}>{notice.title}</Notice>
                )}
                {error && (
                  <Notice tone="danger">
                    <div className={styles.errorBody}>
                      <span>{error}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setReloadKey((key) => key + 1)}
                        disabled={anyBusy || showLoading}
                      >
                        {t("aiSession.retry")}
                      </Button>
                    </div>
                  </Notice>
                )}

                <div className={styles.toolbar}>
                  <div className={styles.toolbarGroup}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ExternalLink size={14} aria-hidden="true" />}
                      onClick={handleOpenTool}
                      disabled={anyBusy || !canOpenTool || !project.pathExists}
                    >
                      {opening
                        ? t("aiSession.openingTool")
                        : t("aiSession.openTool")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus size={14} aria-hidden="true" />}
                      onClick={() => {
                        setMode("create");
                        setNewName("");
                        setCreateError(null);
                      }}
                      disabled={
                        anyBusy ||
                        mode === "create" ||
                        !canCreate ||
                        !project.pathExists
                      }
                    >
                      {t("aiSession.newSession")}
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw size={14} aria-hidden="true" />}
                    onClick={() => setReloadKey((key) => key + 1)}
                    disabled={anyBusy || showLoading}
                  >
                    {t("aiSession.refresh")}
                  </Button>
                </div>

                {selectedTool && !canOpenTool && (
                  <p className={styles.hint}>
                    {t("aiSession.openToolHint", {
                      reason: selectedTool.launch.reason,
                    })}
                  </p>
                )}

                {mode === "create" && (
                  <div className={styles.createForm}>
                    <TextField
                      label={t("aiSession.nameLabel")}
                      value={newName}
                      placeholder={t("aiSession.namePlaceholder")}
                      hint={t("aiSession.nameHint")}
                      error={createError ?? undefined}
                      maxLength={140}
                      autoFocus
                      disabled={creating}
                      onChange={(event) => setNewName(event.target.value)}
                    />
                    <div className={styles.formActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setMode("list");
                          setCreateError(null);
                        }}
                        disabled={creating}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Play size={14} aria-hidden="true" />}
                        onClick={handleCreate}
                        disabled={creating}
                      >
                        {creating ? t("aiSession.creating") : t("aiSession.create")}
                      </Button>
                    </div>
                  </div>
                )}

                {showLoading ? (
                  <LoadingState label={t("aiSession.loading")} />
                ) : historyState && historyState !== "available" ? (
                  <Notice
                    tone={HISTORY_STATE_TONE[historyState]}
                    title={t(HISTORY_STATE_KEY[historyState])}
                  >
                    {t(HISTORY_STATE_DESC_KEY[historyState])}
                  </Notice>
                ) : sessions.length > 0 ? (
                  <ul className={styles.list}>
                    {sessions.map((session) => {
                      const state = getAiSessionState(session, capabilities, {
                        projectPathExists: session.projectPathExists,
                        markedMissing: markedMissing.has(session.id),
                      });
                      const editing = editingId === session.id;
                      const rowBusy = busyId === session.id;
                      return (
                        <li key={session.id} className={styles.item}>
                          {editing ? (
                            <div className={styles.editForm}>
                              <TextField
                                label={t("aiSession.nameLabel")}
                                value={editName}
                                error={editError ?? undefined}
                                maxLength={140}
                                autoFocus
                                disabled={rowBusy}
                                onChange={(event) =>
                                  setEditName(event.target.value)
                                }
                              />
                              {canSyncNative ? (
                                <label className={styles.checkbox}>
                                  <input
                                    type="checkbox"
                                    checked={editSyncNative}
                                    disabled={rowBusy}
                                    onChange={(event) =>
                                      setEditSyncNative(event.target.checked)
                                    }
                                  />
                                  <span>{t("aiSession.syncNativeLabel")}</span>
                                </label>
                              ) : (
                                <p className={styles.hint}>
                                  {t("aiSession.localOnlyNote")}
                                </p>
                              )}
                              <div className={styles.formActions}>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditError(null);
                                  }}
                                  disabled={rowBusy}
                                >
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleRename(session)}
                                  disabled={rowBusy}
                                >
                                  {rowBusy
                                    ? t("common.saving")
                                    : t("common.save")}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={styles.itemMain}>
                                <div className={styles.itemTitleRow}>
                                  <span
                                    className={styles.itemTitle}
                                    title={aiSessionName(session)}
                                  >
                                    {aiSessionName(session)}
                                  </span>
                                  <Badge tone={state.tone}>
                                    {t(state.labelKey)}
                                  </Badge>
                                  {session.status === "archived" && (
                                    <Badge tone="neutral">
                                      {t("aiSession.statusArchived")}
                                    </Badge>
                                  )}
                                </div>
                                <span className={styles.itemMeta}>
                                  <History size={12} aria-hidden="true" />
                                  {session.lastUsedAt
                                    ? t("aiSession.lastUsed", {
                                        time: formatRelativeTime(
                                          session.lastUsedAt,
                                        ),
                                      })
                                    : t("aiSession.updatedAt", {
                                        time: formatRelativeTime(
                                          session.updatedAt,
                                        ),
                                      })}
                                </span>
                              </div>
                              <div className={styles.itemActions}>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  icon={<Play size={14} aria-hidden="true" />}
                                  onClick={() => handleRestore(session)}
                                  disabled={!state.canRestore || anyBusy}
                                >
                                  {rowBusy
                                    ? t("aiSession.restoring")
                                    : t("aiSession.restore")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<Pencil size={14} aria-hidden="true" />}
                                  onClick={() => startEdit(session)}
                                  disabled={anyBusy}
                                >
                                  {t("aiSession.rename")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<Trash2 size={14} aria-hidden="true" />}
                                  onClick={() => {
                                    setDeleteScope("local");
                                    setConfirmDelete(session);
                                  }}
                                  disabled={anyBusy}
                                >
                                  {t("aiSession.delete")}
                                </Button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : error ? null : (
                  <EmptyState
                    icon={MessageSquare}
                    title={t("aiSession.emptyTitle")}
                    description={t("aiSession.emptyDescription")}
                    compact
                  />
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("aiSession.deleteTitle")}
        description={
          confirmDelete
            ? `${t("aiSession.deleteConfirmName", {
                name: aiSessionName(confirmDelete),
              })} ${t("aiSession.deleteContext", {
                project: confirmDelete.projectName ?? project?.name ?? "",
                tool:
                  confirmDelete.toolName ??
                  selectedTool?.name ??
                  t("projectList.noTool"),
              })}`
            : undefined
        }
        confirmLabel={t("common.delete")}
        tone="danger"
        busy={busyId !== null}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      >
        {confirmDelete && (
          <RadioGroup
            name="delete-scope"
            value={deleteScope}
            options={deleteScopeOptions(confirmDelete)}
            onChange={setDeleteScope}
            ariaLabel={t("aiSession.deleteScopeLabel")}
            disabled={busyId !== null}
          />
        )}
      </ConfirmDialog>
    </>
  );
}
