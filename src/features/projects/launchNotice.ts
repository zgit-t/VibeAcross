import type { TranslationKey, TranslationVars } from "../../i18n";
import type { LaunchResult } from "../../types/domain";

/** 与 `useI18n()` 的 `t` 签名一致，便于在纯函数中注入翻译器。 */
export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

/** 启动成功后的提示内容。 */
export interface LaunchNotice {
  title: string;
  message: string;
}

/**
 * 构建启动成功后的如实提示。
 *
 * 明确区分「进程已创建」与「已在工具内初始化任务 / 会话」：当前后端不向工具
 * 传递任何会话参数，`contextInitialized` 恒为 `false`，此时追加提示要求用户在
 * 工具内手动继续，绝不谎报任务已初始化。
 */
export function buildLaunchNotice(
  result: Pick<
    LaunchResult,
    "toolName" | "pid" | "workingDir" | "contextInitialized"
  >,
  t: Translate,
  titleKey: TranslationKey = "projects.launchedTitle",
): LaunchNotice {
  const base = t("projects.launchedMessage", { dir: result.workingDir });
  return {
    title: t(titleKey, { tool: result.toolName, pid: result.pid }),
    message: result.contextInitialized
      ? base
      : `${base} ${t("launch.noContextNote")}`,
  };
}
