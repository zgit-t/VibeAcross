import { useMemo, useState } from "react";
import { MessagesSquare, Play } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useProjects } from "../../context/ProjectsContext";
import { useTools } from "../../context/ToolsContext";
import { useRevision } from "../../context/RevisionContext";
import { useI18n } from "../../i18n";
import { Section } from "../../components/layout/Section";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingState } from "../../components/ui/LoadingState";
import { Notice } from "../../components/ui/Notice";
import { aiSessionName } from "./meta";
import {
  sessionActivityTime,
  useRecentSessions,
} from "./useRecentSessions";
import { useToolCapabilities } from "./useToolCapabilities";
import { sessionOpenability } from "./openability";
import type { OpenSessionBlockReason } from "./openability";
import { toErrorMessage } from "../../services/backend";
import { restoreNativeSession } from "../../services/sessions";
import { formatRelativeTime } from "../../utils/format";
import type { AiSession } from "../../types/domain";
import styles from "./RecentSessionsSection.module.css";

/** 阻止打开的原因 → 文案键。 */
const BLOCK_REASON_KEY: Record<
  OpenSessionBlockReason,
  | "overview.recentSessions.reasonProjectGone"
  | "overview.recentSessions.reasonPathMissing"
  | "overview.recentSessions.reasonNoNativeId"
  | "overview.recentSessions.reasonToolUnavailable"
  | "overview.recentSessions.reasonUnsupported"
  | "overview.recentSessions.reasonChecking"
> = {
  projectGone: "overview.recentSessions.reasonProjectGone",
  pathMissing: "overview.recentSessions.reasonPathMissing",
  noNativeId: "overview.recentSessions.reasonNoNativeId",
  toolUnavailable: "overview.recentSessions.reasonToolUnavailable",
  unsupported: "overview.recentSessions.reasonUnsupported",
  checking: "overview.recentSessions.reasonChecking",
};

/**
 * 概览页「最近会话」区块。
 *
 * 数据来自真实的本地会话记录，按最近活动时间倒序展示。点击「打开会话」只会打开
 * 一个居中二次确认框；确认后调用后端**已核实的原生会话恢复接口**，直接打开用户
 * 选中的那一条会话——绝不进入项目运行流程、不打开项目详情、不新建会话，也不默认
 * 打开最近一条会话。工具不支持 / 记录缺失 / 目录或工具不可用时，在确认前如实说明
 * 并禁用确认，保留取消路径，绝不静默降级为「打开项目」。
 */
export function RecentSessionsSection() {
  const { navigate } = useApp();
  const { projects } = useProjects();
  const { tools } = useTools();
  const { bumpRevision } = useRevision();
  const { t } = useI18n();
  const { sessions, loading, error, reload } = useRecentSessions();

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const toolById = useMemo(
    () => new Map(tools.map((tool) => [tool.id, tool])),
    [tools],
  );
  const toolIds = useMemo(
    () =>
      sessions
        .map((session) => toolById.get(session.toolId)?.toolId)
        .filter((value): value is string => Boolean(value)),
    [sessions, toolById],
  );
  const { capabilities } = useToolCapabilities(toolIds);

  const [pending, setPending] = useState<AiSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openedName, setOpenedName] = useState<string | null>(null);

  function requestOpen(session: AiSession) {
    setActionError(null);
    setOpenedName(null);
    setPending(session);
  }

  function closeDialog() {
    if (busy) {
      return;
    }
    setPending(null);
    setActionError(null);
  }

  async function confirmOpen() {
    if (!pending || busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      // 复用后端已核实的原生会话恢复接口，传入明确的 session id。
      await restoreNativeSession(pending.id);
      bumpRevision();
      setOpenedName(aiSessionName(pending));
      setPending(null);
    } catch (cause) {
      setActionError(
        toErrorMessage(cause, t("overview.recentSessions.openFailed")),
      );
    } finally {
      setBusy(false);
    }
  }

  const pendingProject = pending
    ? projectById.get(pending.projectId) ?? null
    : null;
  const pendingTool = pending ? toolById.get(pending.toolId) ?? null : null;
  const pendingCaps = pendingTool ? capabilities[pendingTool.toolId] : undefined;
  const availability = pending
    ? sessionOpenability(pending, pendingProject, pendingTool, pendingCaps)
    : null;
  const pendingChecking = availability?.reason === "checking";

  return (
    <Section
      title={t("overview.recentSessions.title")}
      description={t("overview.recentSessions.description")}
      action={
        <Button variant="ghost" size="sm" onClick={() => navigate("projects")}>
          {t("overview.recentSessions.goProjects")}
        </Button>
      }
    >
      {error ? (
        <div className={styles.notice}>
          <Notice tone="danger">
            {error}
            <div className={styles.noticeAction}>
              <Button variant="secondary" size="sm" onClick={reload}>
                {t("common.retry")}
              </Button>
            </div>
          </Notice>
        </div>
      ) : loading && sessions.length === 0 ? (
        <LoadingState label={t("common.loading")} />
      ) : sessions.length === 0 ? (
        <EmptyState
          compact
          icon={MessagesSquare}
          title={t("overview.recentSessions.emptyTitle")}
          description={t("overview.recentSessions.emptyDescription")}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("projects")}
            >
              {t("overview.recentSessions.goProjects")}
            </Button>
          }
        />
      ) : (
        <>
          {openedName && (
            <div className={styles.notice}>
              <Notice tone="success">
                {t("overview.recentSessions.opened", { name: openedName })}
              </Notice>
            </div>
          )}
          <ul className={styles.list}>
            {sessions.map((session) => {
              const project = projectById.get(session.projectId) ?? null;
              const tool = toolById.get(session.toolId) ?? null;
              const caps = tool ? capabilities[tool.toolId] : undefined;
              const openability = sessionOpenability(
                session,
                project,
                tool,
                caps,
              );
              const hintKey =
                openability.reason && openability.reason !== "checking"
                  ? BLOCK_REASON_KEY[openability.reason]
                  : null;

              return (
                <li key={session.id} className={styles.item}>
                  <span className={styles.icon} aria-hidden="true">
                    <MessagesSquare size={16} />
                  </span>

                  <div className={styles.main}>
                    <div className={styles.titleRow}>
                      <span className={styles.title}>
                        {aiSessionName(session)}
                      </span>
                      {project === null ? (
                        <Badge tone="warning">
                          {t("overview.recentSessions.projectGone")}
                        </Badge>
                      ) : !session.projectPathExists ? (
                        <Badge tone="warning">{t("health.pathMissing")}</Badge>
                      ) : null}
                      {!tool?.installed && (
                        <Badge tone="warning">
                          {t("overview.recentSessions.toolUnavailable")}
                        </Badge>
                      )}
                    </div>
                    <div className={styles.meta}>
                      <span>
                        {session.projectName ??
                          t("overview.resume.projectDeleted")}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {session.toolName ?? t("overview.resume.noTool")}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("overview.recentSessions.lastUsed", {
                          time: formatRelativeTime(sessionActivityTime(session)),
                        })}
                      </span>
                    </div>
                    {hintKey && <p className={styles.hint}>{t(hintKey)}</p>}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Play size={14} aria-hidden="true" />}
                    onClick={() => requestOpen(session)}
                  >
                    {t("overview.recentSessions.open")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t("overview.recentSessions.dialogTitle")}
        description={t("overview.recentSessions.dialogDescription")}
        confirmLabel={t("overview.recentSessions.confirm")}
        busy={busy}
        confirmDisabled={!availability?.canOpen}
        onConfirm={() => void confirmOpen()}
        onClose={closeDialog}
      >
        {pending && (
          <div className={styles.dialogBody}>
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{t("overview.recentSessions.fieldSession")}</dt>
                <dd>{aiSessionName(pending)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("overview.recentSessions.fieldProject")}</dt>
                <dd>
                  {pending.projectName ??
                    t("overview.resume.projectDeleted")}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{t("overview.recentSessions.fieldTool")}</dt>
                <dd>
                  {pendingTool?.name ??
                    pending.toolName ??
                    t("overview.resume.noTool")}
                </dd>
              </div>
            </dl>
            {availability && availability.reason && (
              <Notice tone={pendingChecking ? "info" : "warning"}>
                {t(BLOCK_REASON_KEY[availability.reason])}
              </Notice>
            )}
            {actionError && <Notice tone="danger">{actionError}</Notice>}
          </div>
        )}
      </ConfirmDialog>
    </Section>
  );
}
