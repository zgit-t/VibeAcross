import { describe, expect, it } from "vitest";
import type { TranslationKey, TranslationVars } from "../../i18n";
import { buildLaunchNotice } from "./launchNotice";

const DICT: Partial<Record<TranslationKey, string>> = {
  "projects.launchedTitle": "已启动 {tool} 的进程",
  "projectDetail.launched": "已启动 {tool} 的进程（PID {pid}）。",
  "projects.launchedMessage": "工作目录：{dir}",
  "launch.noContextNote":
    "未在工具中创建任务或会话；请在工具内手动打开项目或开始新的对话。",
};

const t = (key: TranslationKey, vars?: TranslationVars): string => {
  let value = DICT[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replace(`{${name}}`, String(replacement));
    }
  }
  return value;
};

const baseResult = {
  toolName: "Cursor",
  pid: 4321,
  workingDir: "D:\\work\\demo",
  contextInitialized: false,
};

describe("buildLaunchNotice", () => {
  it("appends the no-context note when nothing was initialized", () => {
    const notice = buildLaunchNotice(baseResult, t);
    expect(notice.title).toBe("已启动 Cursor 的进程");
    expect(notice.message).toBe(
      "工作目录：D:\\work\\demo 未在工具中创建任务或会话；请在工具内手动打开项目或开始新的对话。",
    );
  });

  it("omits the note when the backend reported an initialized context", () => {
    const notice = buildLaunchNotice(
      { ...baseResult, contextInitialized: true },
      t,
    );
    expect(notice.message).toBe("工作目录：D:\\work\\demo");
  });

  it("honors a custom title key and interpolates the pid", () => {
    const notice = buildLaunchNotice(baseResult, t, "projectDetail.launched");
    expect(notice.title).toBe("已启动 Cursor 的进程（PID 4321）。");
  });
});
