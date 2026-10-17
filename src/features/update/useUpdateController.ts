/**
 * 更新控制器：把底层更新服务的状态翻译成界面可直接使用的文案与动作。
 * 关于页面、设置页面、全局「更新就绪」弹窗共用此 Hook，保证行为一致。
 */

import { useMemo } from "react";
import { useI18n } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import { APP_VERSION } from "../../config/app";
import { formatRelativeTime } from "../../utils/format";
import {
  checkForUpdates,
  dismissUpdate,
  downloadUpdate,
  installUpdate,
  useUpdateState,
} from "../../services/updater";
import type { UpdateErrorKind, UpdateState } from "../../services/updater";

const ERROR_MESSAGE_KEYS: Record<UpdateErrorKind, TranslationKey> = {
  network: "update.errorNetwork",
  invalidResponse: "update.errorInvalidResponse",
  invalidVersion: "update.errorInvalidVersion",
  download: "update.errorDownload",
  signature: "update.errorSignature",
  install: "update.errorInstall",
  notDesktop: "update.errorNotDesktop",
  unknown: "update.errorGeneric",
};

const LOCALIZED_ERROR_KINDS: UpdateErrorKind[] = [
  "network",
  "invalidResponse",
  "signature",
  "download",
  "install",
  "notDesktop",
  "invalidVersion",
];

export interface UpdateController {
  state: UpdateState;
  /** 当前是否有进行中的操作（检查 / 下载 / 安装），用于禁用按钮。 */
  busy: boolean;
  /** 状态栏文案；无合适文案时为 null。 */
  statusText: string | null;
  /** 错误文案；非错误态为 null。 */
  errorText: string | null;
  /** 最近检查时间文案；从未检查为 null。 */
  lastCheckedText: string | null;
  /** 是否处于「可安装」状态。 */
  ready: boolean;
  check: () => void;
  download: () => void;
  install: () => void;
  dismiss: () => void;
}

function resolveErrorText(
  state: UpdateState,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const kind = state.errorKind ?? "unknown";
  if (LOCALIZED_ERROR_KINDS.includes(kind)) {
    return t(ERROR_MESSAGE_KEYS[kind], { version: state.version ?? "" });
  }
  return state.errorMessage ?? t(ERROR_MESSAGE_KEYS[kind]);
}

export function useUpdateController(): UpdateController {
  const { t } = useI18n();
  const state = useUpdateState();

  return useMemo<UpdateController>(() => {
    const busy =
      state.phase === "checking" ||
      state.phase === "downloading" ||
      state.phase === "installing";

    let statusText: string | null = null;
    switch (state.phase) {
      case "checking":
        statusText = t("update.checking");
        break;
      case "upToDate":
        statusText = t("update.upToDateHint", { version: APP_VERSION });
        break;
      case "available":
        statusText = state.version
          ? t("update.available", { version: state.version })
          : null;
        break;
      case "downloading":
        statusText =
          state.progress != null
            ? t("update.downloading", {
                percent: Math.round(state.progress * 100),
              })
            : t("update.downloadingUnknown");
        break;
      case "ready":
        statusText = t("update.ready");
        break;
      case "installing":
        statusText = t("update.installing");
        break;
      default:
        statusText = null;
    }

    return {
      state,
      busy,
      statusText,
      errorText: state.phase === "error" ? resolveErrorText(state, t) : null,
      lastCheckedText: state.lastCheckedAt
        ? t("update.lastChecked", {
            time: formatRelativeTime(new Date(state.lastCheckedAt).toISOString()),
          })
        : null,
      ready: state.phase === "ready",
      check: () => void checkForUpdates(),
      download: () => void downloadUpdate(),
      install: () => void installUpdate(),
      dismiss: () => void dismissUpdate(),
    };
  }, [state, t]);
}
