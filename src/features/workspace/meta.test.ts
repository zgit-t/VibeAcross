import { describe, expect, it } from "vitest";
import type {
  LaunchSupport,
  ToolEntry,
  WorkspaceSession,
} from "../../types/domain";
import { getSessionState, restorableTools, sessionName } from "./meta";

function makeTool(id: string, support: LaunchSupport): ToolEntry {
  return {
    id,
    toolId: id,
    name: id,
    vendor: "",
    description: "",
    toolType: "desktop",
    source: "builtin",
    status: "detected",
    executablePath: null,
    commandName: null,
    version: null,
    detectionMethod: null,
    isCustom: false,
    isDefault: false,
    detectedAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null,
    autoDetectReliable: false,
    detectionNote: "",
    launch: {
      support,
      method: support === "supported" ? "folderArgument" : null,
      reason: "",
    },
    restore: {
      level: support === "supported" ? "project" : "none",
      levelReason: "",
      session: "unsupported",
      sessionReason: "",
    },
    installed: support === "supported",
  };
}

function makeSession(
  overrides: Partial<WorkspaceSession> = {},
): WorkspaceSession {
  return Object.assign(
    {
      id: "s1",
      projectId: "p1",
      projectName: "示例项目",
      projectPathExists: true,
      toolId: null,
      toolName: null,
      taskId: null,
      taskTitle: null,
      label: null,
      restoreLevel: "project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
      lastRestoreStatus: null,
      lastRestoreError: null,
    } satisfies WorkspaceSession,
    overrides,
  );
}

describe("getSessionState", () => {
  it("项目目录不存在时优先判定为 projectMissing", () => {
    const tools = { t1: makeTool("t1", "supported") };
    const state = getSessionState(
      makeSession({ projectPathExists: false, toolId: "t1" }),
      tools,
      null,
    );
    expect(state.id).toBe("projectMissing");
    expect(state.canRestore).toBe(false);
    expect(state.tone).toBe("danger");
  });

  it("工具受控启动可用且未失败时为 ready", () => {
    const state = getSessionState(
      makeSession({ toolId: "t1" }),
      { t1: makeTool("t1", "supported") },
      null,
    );
    expect(state.id).toBe("ready");
    expect(state.canRestore).toBe(true);
  });

  it("上次恢复失败时标记为 restoreFailed 但仍可重试", () => {
    const state = getSessionState(
      makeSession({ toolId: "t1", lastRestoreStatus: "failed" }),
      { t1: makeTool("t1", "supported") },
      null,
    );
    expect(state.id).toBe("restoreFailed");
    expect(state.canRestore).toBe(true);
  });

  it("记录未指定工具时回退到项目默认工具", () => {
    const state = getSessionState(
      makeSession({ toolId: null }),
      { t1: makeTool("t1", "supported") },
      "t1",
    );
    expect(state.id).toBe("ready");
  });

  it("既无记录工具也无默认工具时判定为需要补充配置", () => {
    const state = getSessionState(makeSession(), {}, null);
    expect(state.id).toBe("needsConfiguration");
    expect(state.canRestore).toBe(false);
  });

  it("回退到默认工具但条目不存在时判定为需要补充配置", () => {
    const state = getSessionState(makeSession(), {}, "missing-tool");
    expect(state.id).toBe("needsConfiguration");
  });

  it("工具不支持受控启动时判定为不支持", () => {
    const state = getSessionState(
      makeSession({ toolId: "t1" }),
      { t1: makeTool("t1", "unsupported") },
      null,
    );
    expect(state.id).toBe("unsupported");
    expect(state.canRestore).toBe(false);
  });

  it("工具不可用时判定为 toolUnavailable", () => {
    const state = getSessionState(
      makeSession({ toolId: "t1" }),
      { t1: makeTool("t1", "unavailable") },
      null,
    );
    expect(state.id).toBe("toolUnavailable");
  });
});

describe("sessionName", () => {
  it("优先使用用户标签", () => {
    expect(sessionName(makeSession({ label: "登录功能" }))).toBe("登录功能");
  });

  it("无标签时回退到项目名", () => {
    expect(sessionName(makeSession())).toBe("示例项目");
  });

  it("均缺失时使用兜底名称", () => {
    expect(sessionName(makeSession({ projectName: null }))).toBe(
      "未命名工作上下文",
    );
  });
});

describe("restorableTools", () => {
  it("仅保留支持受控启动的工具", () => {
    const tools = [
      makeTool("a", "supported"),
      makeTool("b", "unsupported"),
      makeTool("c", "needsConfiguration"),
      makeTool("d", "supported"),
    ];
    expect(restorableTools(tools).map((tool) => tool.id)).toEqual(["a", "d"]);
  });
});
