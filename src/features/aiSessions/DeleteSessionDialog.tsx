import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { toErrorMessage } from "../../services/backend";
import { deleteSessionScoped } from "../../services/sessions";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { aiSessionName } from "./meta";
import type {
  AiSession,
  DeleteScope,
  NativeSessionCapabilities,
  SessionDeleteOutcome,
} from "../../types/domain";
import styles from "./DeleteSessionDialog.module.css";

interface DeleteSessionDialogProps {
  open: boolean;
  session: AiSession | null;
  projectName: string;
  toolName: string;
  /** 工具能力；未取到时按「无法确认」处理，绝不默认支持原生删除。 */
  capabilities: NativeSessionCapabilities | undefined;
  onClose: () => void;
  onCompleted: (outcome: SessionDeleteOutcome) => void;
}

const SCOPE_LABEL_KEY = {
  local: "aiSession.deleteScopeLocal",
  native: "aiSession.deleteScopeNative",
  both: "aiSession.deleteScopeBoth",
} as const;

/**
 * 会话删除范围选择与确认。
 *
 * 本地删除只需一次确认；原生 / 两者删除必须再经过一个二次确认弹窗，并在确认内容中
 * 明确展示工具、项目、会话标题与删除范围。工具能力未知或不支持时不提供原生选项。
 */
export function DeleteSessionDialog({
  open,
  session,
  projectName,
  toolName,
  capabilities,
  onClose,
  onCompleted,
}: DeleteSessionDialogProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<DeleteScope>("local");
  const [phase, setPhase] = useState<"select" | "confirm">("select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionId = session?.id ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setScope("local");
    setPhase("select");
    setBusy(false);
    setError(null);
  }, [open, sessionId]);

  if (!open || !session) {
    return null;
  }

  const nativeDeleted = session.status === "nativeDeleted";
  const hasNativeId = Boolean(session.nativeSessionId?.trim());
  const nativeSupported =
    capabilities?.delete === "supported" &&
    capabilities?.nativeId === "supported";
  const canNative = !nativeDeleted && hasNativeId && nativeSupported;

  let nativeUnavailableReason: string | null = null;
  if (nativeDeleted) {
    nativeUnavailableReason = t("aiSession.deleteScopeNativeAlreadyDeleted");
  } else if (!hasNativeId) {
    nativeUnavailableReason = t("aiSession.deleteScopeNoNativeId");
  } else if (!capabilities) {
    nativeUnavailableReason = t("aiSession.deleteScopeNativeChecking");
  } else if (!nativeSupported) {
    nativeUnavailableReason = t("aiSession.deleteScopeNativeUnsupported", {
      tool: toolName,
    });
  }

  const label = aiSessionName(session);
  const targetSessionId = session.id;

  function changeScope(next: DeleteScope) {
    if (next !== "local" && !canNative) {
      return;
    }
    setScope(next);
    setPhase("select");
    setError(null);
  }

  async function runDelete() {
    if (busy) {
      return;
    }
    if (scope !== "local" && !canNative) {
      setError(nativeUnavailableReason ?? t("aiSession.deleteFailed"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const outcome = await deleteSessionScoped(targetSessionId, scope);
      onCompleted(outcome);
    } catch (cause) {
      setError(toErrorMessage(cause, t("aiSession.deleteFailed")));
    } finally {
      setBusy(false);
    }
  }

  const needsConfirm = scope !== "local";
  const firstAction = needsConfirm
    ? t("aiSession.deleteContinue")
    : t("aiSession.deleteLocalAction");

  return (
    <>
      <Modal
        open={phase === "select"}
        title={t("aiSession.deleteTitle")}
        description={t("aiSession.deleteConfirmName", { name: label })}
        size="sm"
        onClose={busy ? () => undefined : onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (needsConfirm) {
                  setPhase("confirm");
                } else {
                  void runDelete();
                }
              }}
              disabled={busy}
            >
              {busy ? t("common.processing") : firstAction}
            </Button>
          </>
        }
      >
        <div className={styles.body}>
          <DeleteContext
            projectName={projectName}
            toolName={toolName}
            sessionName={label}
            scopeLabel={t(SCOPE_LABEL_KEY[scope])}
          />

          <fieldset className={styles.scopeGroup}>
            <legend className={styles.legend}>
              {t("aiSession.deleteScopeLabel")}
            </legend>
            {(
              [
                {
                  value: "local" as const,
                  title: t("aiSession.deleteScopeLocal"),
                  description: t("aiSession.deleteScopeLocalDesc"),
                  note: null,
                },
                {
                  value: "native" as const,
                  title: t("aiSession.deleteScopeNative"),
                  description: t("aiSession.deleteScopeNativeDesc"),
                  note: t("aiSession.deleteScopeNativeNote"),
                },
                {
                  value: "both" as const,
                  title: t("aiSession.deleteScopeBoth"),
                  description: t("aiSession.deleteScopeBothDesc"),
                  note: t("aiSession.deleteScopeBothNote"),
                },
              ] as const
            ).map((option) => {
              const disabled = option.value !== "local" && !canNative;
              return (
                <label
                  key={option.value}
                  className={`${styles.option} ${
                    disabled ? styles.optionDisabled : ""
                  }`}
                >
                  <input
                    type="radio"
                    name={`delete-scope-${session.id}`}
                    value={option.value}
                    checked={scope === option.value}
                    disabled={busy || disabled}
                    onChange={() => changeScope(option.value)}
                  />
                  <span className={styles.optionContent}>
                    <span className={styles.optionTitle}>{option.title}</span>
                    <span className={styles.optionDescription}>
                      {option.description}
                    </span>
                    {option.note && !disabled && (
                      <span className={styles.optionNote}>{option.note}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {nativeUnavailableReason && (
            <Notice tone="info">{nativeUnavailableReason}</Notice>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </Modal>

      <ConfirmDialog
        open={phase === "confirm" && needsConfirm}
        title={t("aiSession.deleteNativeConfirmTitle")}
        description={t("aiSession.deleteConfirmName", { name: label })}
        confirmLabel={t("aiSession.deleteConfirmAction")}
        tone="danger"
        busy={busy}
        onConfirm={() => void runDelete()}
        onClose={() => setPhase("select")}
      >
        <div className={styles.body}>
          <DeleteContext
            projectName={projectName}
            toolName={toolName}
            sessionName={label}
            scopeLabel={t(SCOPE_LABEL_KEY[scope])}
          />
          <Notice tone="warning">{t("aiSession.deleteNativeImpact")}</Notice>
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      </ConfirmDialog>
    </>
  );
}

function DeleteContext({
  projectName,
  toolName,
  sessionName,
  scopeLabel,
}: {
  projectName: string;
  toolName: string;
  sessionName: string;
  scopeLabel: string;
}) {
  const { t } = useI18n();
  return (
    <dl className={styles.context}>
      <dt>{t("aiSession.deleteContextProject")}</dt>
      <dd>{projectName}</dd>
      <dt>{t("aiSession.deleteContextTool")}</dt>
      <dd>{toolName}</dd>
      <dt>{t("aiSession.deleteContextSession")}</dt>
      <dd>{sessionName}</dd>
      <dt>{t("aiSession.deleteContextScope")}</dt>
      <dd>{scopeLabel}</dd>
    </dl>
  );
}
