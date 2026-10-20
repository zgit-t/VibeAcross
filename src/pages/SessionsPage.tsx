import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  MessagesSquare,
  Pencil,
  Play,
  RefreshCw,
  SearchX,
  Trash2,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useProjects } from "../context/ProjectsContext";
import { useRevision } from "../context/RevisionContext";
import { useTools } from "../context/ToolsContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { Modal } from "../components/ui/Modal";
import { Notice } from "../components/ui/Notice";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { TextField } from "../components/ui/TextField";
import { SessionDialog } from "../features/workspace/SessionDialog";
import {
  dedupeSessions,
  filterSessions,
  sessionActivitySource,
  sessionActivityTime,
  sessionDisplayName,
  sortSessions,
} from "../features/aiSessions/center";
import type { SessionSort } from "../features/aiSessions/center";
import { DeleteSessionDialog } from "../features/aiSessions/DeleteSessionDialog";
import { getAiSessionState } from "../features/aiSessions/meta";
import { sessionOpenability } from "../features/aiSessions/openability";
import type { OpenSessionBlockReason } from "../features/aiSessions/openability";
import { useRecentSessions } from "../features/aiSessions/useRecentSessions";
import { useToolCapabilities } from "../features/aiSessions/useToolCapabilities";
import { isBackendError, toErrorMessage } from "../services/backend";
import { launchProject } from "../services/projects";
import {
  renameNativeSession,
  restoreNativeSession,
  syncNativeSessions,
} from "../services/sessions";
import { formatRelativeTime } from "../utils/format";
import type {
  AiSession,
  NativeSessionCapabilities,
  Project,
  SessionDeleteOutcome,
  ToolEntry,
  WorkspaceSession,
} from "../types/domain";
import styles from "./SessionsPage.module.css";

/** 阻止直接打开的原因 → 文案键（与概览「最近会话」复用同一组说明）。 */
const BLOCK_REASON_KEY: Record<
  OpenSessionBlockReason,
  | "overview.recentSessions.reasonProjectGone"
  | "overview.recentSessions.reasonPathMissing"
  | "overview.recentSessions.reasonNativeDeleted"
  | "overview.recentSessions.reasonNoNativeId"
  | "overview.recentSessions.reasonToolUnavailable"
  | "overview.recentSessions.reasonUnsupported"
  | "overview.recentSessions.reasonChecking"
  | "sessionCenter.nativeDeletedHint"
> = {
  projectGone: "overview.recentSessions.reasonProjectGone",
  pathMissing: "overview.recentSessions.reasonPathMissing",
  nativeDeleted: "sessionCenter.nativeDeletedHint",
  noNativeId: "overview.recentSessions.reasonNoNativeId",
  toolUnavailable: "overview.recentSessions.reasonToolUnavailable",
  unsupported: "overview.recentSessions.reasonUnsupported",
  checking: "overview.recentSessions.reasonChecking",
};

interface ActionNotice {
  tone: "success" | "warning";
  message: string;
}

/**
 * 会话中心页面：集中查看和管理跨项目 / 跨 AI 工具的会话记录。
 *
 * 数据直接来自统一的本地会话记录（与概览「最近会话」、项目运行会话同一份数据源），
 * 不新增任何存储。支持搜索、按项目 / 工具筛选、排序、打开、重命名、删除与刷新；
 * 打开只调用后端已核实的原生会话恢复接口，绝不退化为静默创建或打开项目。删除必须
 * 明确选择本地 / 原生 / 两者范围，原生删除只在能力核实后提供并需要二次确认。
 */
export function SessionsPage() {
  const { t } = useI18n();
  const { openProject, pendingSessionId, clearPendingSession } = useApp();
  const { projects } = useProjects();
  const { tools } = useTools();
  const { desktopAvailable, bumpRevision } = useRevision();
  const { sessions: allSessions, loading, error, reload } = useRecentSessions(
    null,
  );
  // 兼容既有深链：全局搜索 / 任务页打开「工作上下文」时，仍在此弹出其编辑框。
  const { sessions: workspaceSessions } = useWorkspace();

  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [toolFilter, setToolFilter] = useState("all");
  const [sort, setSort] = useState<SessionSort>("activity");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [markedMissing, setMarkedMissing] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, AiSession>>(new Map());
  const [renameTarget, setRenameTarget] = useState<AiSession | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameSyncNative, setRenameSyncNative] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiSession | null>(null);
  const [workspaceEditing, setWorkspaceEditing] =
    useState<WorkspaceSession | null>(null);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const toolById = useMemo(
    () => new Map(tools.map((tool) => [tool.id, tool])),
    [tools],
  );

  // 统一的会话列表：先补齐本地重命名结果，再去重并按活动时间排序。
  const sessions = useMemo(() => {
    const merged = allSessions.map(
      (session) => overrides.get(session.id) ?? session,
    );
    return sortSessions(dedupeSessions(merged), "activity");
  }, [allSessions, overrides]);

  const toolIds = useMemo(
    () =>
      sessions
        .map((session) => toolById.get(session.toolId)?.toolId)
        .filter((value): value is string => Boolean(value)),
    [sessions, toolById],
  );
  const { capabilities } = useToolCapabilities(toolIds);

  const projectFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const session of sessions) {
      if (!seen.has(session.projectId)) {
        seen.set(
          session.projectId,
          session.projectName ?? t("sessionCenter.projectUnknown"),
        );
      }
    }
    return [
      { value: "all", label: t("sessionCenter.allProjects") },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [sessions, t]);

  const toolFilterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const session of sessions) {
      if (!seen.has(session.toolId)) {
        seen.set(
          session.toolId,
          session.toolName ?? t("sessionCenter.toolUnknown"),
        );
      }
    }
    return [
      { value: "all", label: t("sessionCenter.allTools") },
      ...Array.from(seen, ([value, label]) => ({ value, label })),
    ];
  }, [sessions, t]);

  const displayed = useMemo(
    () =>
      sortSessions(
        filterSessions(sessions, {
          search,
          projectId: projectFilter === "all" ? null : projectFilter,
          toolId: toolFilter === "all" ? null : toolFilter,
        }),
        sort,
      ),
    [sessions, search, projectFilter, toolFilter, sort],
  );

  const filtersActive =
    search.trim() !== "" || projectFilter !== "all" || toolFilter !== "all";

  // 当所选项目 / 工具已无任何会话（选项消失）时重置筛选，避免下拉框显示与实际
  // 过滤条件不一致、把列表错误地过滤成空。
  useEffect(() => {
    setProjectFilter((value) =>
      value !== "all" &&
      !projectFilterOptions.some((option) => option.value === value)
        ? "all"
        : value,
    );
  }, [projectFilterOptions]);

  useEffect(() => {
    setToolFilter((value) =>
      value !== "all" && !toolFilterOptions.some((option) => option.value === value)
        ? "all"
        : value,
    );
  }, [toolFilterOptions]);

  // 消费来自全局搜索等处的上下文深链，打开对应记录的编辑弹窗。
  useEffect(() => {
    if (!pendingSessionId) {
      return;
    }
    const target = workspaceSessions.find(
      (session) => session.id === pendingSessionId,
    );
    if (target) {
      setWorkspaceEditing(target);
    }
    clearPendingSession();
  }, [pendingSessionId, workspaceSessions, clearPendingSession]);

  function capsFor(session: AiSession): NativeSessionCapabilities | undefined {
    const tool = toolById.get(session.toolId);
    return tool ? capabilities[tool.toolId] : undefined;
  }

  function labelFor(session: AiSession): string {
    return sessionDisplayName(session, t("sessionCenter.unnamed"));
  }

  function clearFilters() {
    setSearch("");
    setProjectFilter("all");
    setToolFilter("all");
  }

  /**
   * 列出「已知且支持枚举」的项目 × 工具组合：只对能力矩阵确认 `list === "supported"`
   * 的组合调用原生同步，绝不假设某工具支持枚举，也绝不触碰用户未涉及的组合。
   */
  function collectSyncPairs(): Array<{ projectId: string; toolId: string }> {
    const seen = new Set<string>();
    const pairs: Array<{ projectId: string; toolId: string }> = [];
    for (const session of sessions) {
      const caps = capsFor(session);
      if (caps?.list !== "supported") {
        continue;
      }
      const key = `${session.projectId}\u0000${session.toolId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      pairs.push({ projectId: session.projectId, toolId: session.toolId });
    }
    return pairs;
  }

  /**
   * 刷新：先尽力把已知组合的原生会话重新同步进本地记录（幂等，可反映工具中新增 /
   * 删除的会话），再重新读取列表。单个组合同步失败不影响整体刷新，只如实提示。
   */
  async function handleRefresh() {
    setActionError(null);
    setNotice(null);
    const pairs = collectSyncPairs();
    if (pairs.length === 0) {
      reload();
      return;
    }
    setRefreshBusy(true);
    try {
      const results = await Promise.allSettled(
        pairs.map(({ projectId, toolId }) =>
          syncNativeSessions(projectId, toolId),
        ),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failed > 0) {
        setNotice({
          tone: "warning",
          message: t("sessionCenter.refreshPartial", { count: failed }),
        });
      }
      // 同步可能写入了新的本地记录：广播版本号以重新拉取列表，并让概览等其它
      // 页面一并更新，保证跨页数据一致。
      bumpRevision();
    } finally {
      setRefreshBusy(false);
    }
  }

  async function handleOpen(session: AiSession) {
    setBusyId(session.id);
    setActionError(null);
    setNotice(null);
    try {
      await restoreNativeSession(session.id);
      bumpRevision();
      setNotice({
        tone: "success",
        message: t("sessionCenter.opened", { name: labelFor(session) }),
      });
    } catch (cause) {
      if (isBackendError(cause) && cause.code === "NATIVE_SESSION_MISSING") {
        setMarkedMissing((prev) => new Set(prev).add(session.id));
      }
      setActionError(toErrorMessage(cause, t("sessionCenter.openFailed")));
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpenProject(session: AiSession) {
    setBusyId(session.id);
    setActionError(null);
    setNotice(null);
    try {
      // 只做「在项目目录中打开该工具」，明确区别于恢复原生会话。
      const result = await launchProject(session.projectId, session.toolId);
      bumpRevision();
      setNotice({
        tone: "success",
        message: t("sessionCenter.openProjectSuccess", {
          tool: result.toolName,
        }),
      });
    } catch (cause) {
      setActionError(toErrorMessage(cause, t("sessionCenter.openProjectFailed")));
    } finally {
      setBusyId(null);
    }
  }

  function startRename(session: AiSession) {
    setRenameTarget(session);
    setRenameName(session.displayName);
    setRenameSyncNative(false);
    setRenameError(null);
  }

  async function handleRename() {
    if (!renameTarget) {
      return;
    }
    const target = renameTarget;
    const name = renameName.trim();
    if (!name) {
      setRenameError(t("aiSession.nameEmpty"));
      return;
    }
    if (name.length > 120) {
      setRenameError(t("aiSession.nameTooLong"));
      return;
    }
    setBusyId(target.id);
    setRenameError(null);
    try {
      const outcome = await renameNativeSession(
        target.id,
        name,
        renameSyncNative,
      );
      bumpRevision();
      setOverrides((prev) => new Map(prev).set(target.id, outcome.session));
      setRenameTarget(null);
    } catch (cause) {
      setRenameError(toErrorMessage(cause, t("aiSession.renameFailed")));
    } finally {
      setBusyId(null);
    }
  }

  function handleDeleteCompleted(
    target: AiSession,
    outcome: SessionDeleteOutcome,
  ) {
    setDeleteTarget(null);
    setActionError(null);
    setNotice(null);
    bumpRevision();

    if (outcome.localCleanupFailed) {
      if (outcome.nativeDeleted) {
        setOverrides((prev) =>
          new Map(prev).set(target.id, {
            ...(prev.get(target.id) ?? target),
            status: "nativeDeleted",
          }),
        );
      }
      setNotice({
        tone: "warning",
        message: t("aiSession.deletePartialNativeOnly", {
          reason: outcome.localCleanupError ?? t("aiSession.deleteFailed"),
        }),
      });
      return;
    }

    if (outcome.localDeleted) {
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(target.id);
        return next;
      });
    } else if (outcome.nativeDeleted) {
      setOverrides((prev) =>
        new Map(prev).set(target.id, {
          ...(prev.get(target.id) ?? target),
          status: "nativeDeleted",
        }),
      );
    }

    if (outcome.scope === "local") {
      setNotice({
        tone: "success",
        message: t("aiSession.deletedLocalOnly", { name: labelFor(target) }),
      });
    } else if (outcome.scope === "native") {
      setNotice({
        tone: "success",
        message: outcome.nativeAlreadyGone
          ? t("aiSession.deleteNativeAlreadyGoneOnly")
          : t("aiSession.deletedNativeOnly"),
      });
    } else {
      setNotice({
        tone: "success",
        message: outcome.nativeAlreadyGone
          ? t("aiSession.deletedBothNativeAlreadyGone")
          : t("aiSession.deletedWithNative", { name: labelFor(target) }),
      });
    }
  }

  const renameCaps = renameTarget ? capsFor(renameTarget) : undefined;
  const canSyncNative =
    renameTarget?.status !== "nativeDeleted" &&
    renameCaps?.renameTitle === "supported";

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("sessionCenter.title")}
        description={t("sessionCenter.description")}
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw size={15} aria-hidden="true" />}
            onClick={() => void handleRefresh()}
            disabled={refreshBusy || loading || busyId !== null}
          >
            {refreshBusy || loading
              ? t("sessionCenter.refreshing")
              : t("sessionCenter.refresh")}
          </Button>
        }
      />

      {!desktopAvailable && (
        <Notice tone="info">{t("aiSession.notDesktop")}</Notice>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t("sessionCenter.searchPlaceholder")}
            label={t("sessionCenter.searchLabel")}
          />
        </div>
        <select
          className={styles.filterSelect}
          aria-label={t("sessionCenter.projectFilterLabel")}
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          {projectFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          aria-label={t("sessionCenter.toolFilterLabel")}
          value={toolFilter}
          onChange={(event) => setToolFilter(event.target.value)}
        >
          {toolFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SegmentedControl
          size="sm"
          ariaLabel={t("sessionCenter.sortLabel")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "activity", label: t("sessionCenter.sortActivity") },
            { value: "name", label: t("sessionCenter.sortName") },
          ]}
        />
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("common.clearFilter")}
          </Button>
        )}
        <span className={styles.count}>
          {loading && sessions.length === 0
            ? t("common.loading")
            : t("sessionCenter.count", { count: displayed.length })}
        </span>
      </div>

      {error && (
        <div className={styles.notice}>
          <Notice tone="danger">
            {error}
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={() => reload()}>
                {t("common.retry")}
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {notice && <Notice tone={notice.tone}>{notice.message}</Notice>}
      {actionError && <Notice tone="danger">{actionError}</Notice>}

      <div className={styles.listWrap}>
        {loading && sessions.length === 0 ? (
          <div className={styles.notice}>
            <LoadingState label={t("sessionCenter.loading")} />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title={t("sessionCenter.emptyTitle")}
            description={t("sessionCenter.emptyDescription")}
          />
        ) : displayed.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t("sessionCenter.noMatchTitle")}
            description={t("sessionCenter.noMatchDescription")}
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {t("common.clearFilter")}
              </Button>
            }
          />
        ) : (
          <ul className={styles.list}>
            {displayed.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                label={labelFor(session)}
                project={projectById.get(session.projectId) ?? null}
                tool={toolById.get(session.toolId) ?? null}
                caps={capsFor(session)}
                markedMissing={markedMissing.has(session.id)}
                busy={busyId === session.id}
                onOpen={handleOpen}
                onOpenProject={handleOpenProject}
                onRename={startRename}
                onDelete={setDeleteTarget}
                onNavigateProject={openProject}
              />
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={renameTarget !== null}
        title={t("sessionCenter.renameTitle")}
        size="sm"
        onClose={busyId !== null ? () => undefined : () => setRenameTarget(null)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRenameTarget(null)}
              disabled={busyId !== null}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleRename()}
              disabled={busyId !== null}
            >
              {busyId !== null ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <TextField
            label={t("aiSession.nameLabel")}
            value={renameName}
            error={renameError ?? undefined}
            maxLength={140}
            autoFocus
            disabled={busyId !== null}
            onChange={(event) => setRenameName(event.target.value)}
          />
          {canSyncNative ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={renameSyncNative}
                disabled={busyId !== null}
                onChange={(event) => setRenameSyncNative(event.target.checked)}
              />
              <span>{t("aiSession.syncNativeLabel")}</span>
            </label>
          ) : (
            <p className={styles.hint}>
              {renameTarget?.status === "nativeDeleted"
                ? t("aiSession.nativeDeletedRenameHint")
                : t("aiSession.localOnlyNote")}
            </p>
          )}
        </div>
      </Modal>

      <DeleteSessionDialog
        open={deleteTarget !== null}
        session={deleteTarget}
        projectName={
          deleteTarget
            ? (projectById.get(deleteTarget.projectId)?.name ??
              deleteTarget.projectName ??
              t("sessionCenter.projectUnknown"))
            : ""
        }
        toolName={
          deleteTarget
            ? (toolById.get(deleteTarget.toolId)?.name ??
              deleteTarget.toolName ??
              t("sessionCenter.toolUnknown"))
            : ""
        }
        capabilities={deleteTarget ? capsFor(deleteTarget) : undefined}
        onClose={() => setDeleteTarget(null)}
        onCompleted={(outcome) => {
          if (deleteTarget) {
            handleDeleteCompleted(deleteTarget, outcome);
          }
        }}
      />

      <SessionDialog
        open={workspaceEditing !== null}
        onClose={() => setWorkspaceEditing(null)}
        session={workspaceEditing}
        projectOptions={projects.map((project) => ({
          id: project.id,
          name: project.name,
        }))}
      />
    </div>
  );
}

interface SessionRowProps {
  session: AiSession;
  label: string;
  project: Project | null;
  tool: ToolEntry | null;
  caps: NativeSessionCapabilities | undefined;
  markedMissing: boolean;
  busy: boolean;
  onOpen: (session: AiSession) => void;
  onOpenProject: (session: AiSession) => void;
  onRename: (session: AiSession) => void;
  onDelete: (session: AiSession) => void;
  onNavigateProject: (projectId: string) => void;
}

/** 单条会话行：展示归属信息与状态，并提供打开 / 重命名 / 删除操作。 */
function SessionRow({
  session,
  label,
  project,
  tool,
  caps,
  markedMissing,
  busy,
  onOpen,
  onOpenProject,
  onRename,
  onDelete,
  onNavigateProject,
}: SessionRowProps) {
  const { t } = useI18n();
  const openability = sessionOpenability(session, project, tool, caps);
  const state = getAiSessionState(session, caps ?? null, {
    projectPathExists: session.projectPathExists,
    markedMissing,
  });
  const hintKey =
    openability.reason && openability.reason !== "checking"
      ? BLOCK_REASON_KEY[openability.reason]
      : null;
  // 仅当工具确实支持「打开项目」且项目目录可用时，才提供这一区别于恢复会话的备用操作。
  const canOpenProjectFallback =
    !openability.canOpen &&
    openability.reason !== "projectGone" &&
    openability.reason !== "pathMissing" &&
    openability.reason !== "toolUnavailable" &&
    openability.reason !== "checking" &&
    tool?.launch.support === "supported";

  return (
    <li className={styles.item}>
      <span className={styles.icon} aria-hidden="true">
        <MessagesSquare size={16} />
      </span>

      <div className={styles.main}>
        <div className={styles.titleRow}>
          <span className={styles.title} title={label}>
            {label}
          </span>
          <Badge tone={state.tone}>{t(state.labelKey)}</Badge>
          {session.status === "archived" && (
            <Badge tone="neutral">{t("aiSession.statusArchived")}</Badge>
          )}
        </div>
        <div className={styles.meta}>
          {project ? (
            <button
              type="button"
              className={styles.metaProject}
              onClick={() => onNavigateProject(session.projectId)}
            >
              {session.projectName ?? t("sessionCenter.projectUnknown")}
            </button>
          ) : (
            <span>{session.projectName ?? t("sessionCenter.projectUnknown")}</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{session.toolName ?? t("sessionCenter.toolUnknown")}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t(
              sessionActivitySource(session) === "lastUsedAt"
                ? "aiSession.lastUsed"
                : "aiSession.updatedAt",
              { time: formatRelativeTime(sessionActivityTime(session)) },
            )}
          </span>
        </div>
        {hintKey && <p className={styles.hint}>{t(hintKey)}</p>}
      </div>

      <div className={styles.actions}>
        {openability.canOpen ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={14} aria-hidden="true" />}
            onClick={() => onOpen(session)}
            disabled={busy}
          >
            {busy ? t("aiSession.restoring") : t("aiSession.restore")}
          </Button>
        ) : canOpenProjectFallback ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={() => onOpenProject(session)}
            disabled={busy}
          >
            {busy
              ? t("sessionCenter.openingProject")
              : t("sessionCenter.openProject")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={() => onRename(session)}
          disabled={busy}
        >
          {t("aiSession.rename")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={14} aria-hidden="true" />}
          onClick={() => onDelete(session)}
          disabled={busy}
        >
          {t("common.delete")}
        </Button>
      </div>
    </li>
  );
}
