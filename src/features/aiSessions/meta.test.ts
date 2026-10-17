import { describe, expect, it } from "vitest";
import type {
  AiSession,
  NativeSessionCapabilities,
  NativeSupport,
} from "../../types/domain";
import { getAiSessionState } from "./meta";

function makeSession(overrides: Partial<AiSession> = {}): AiSession {
  return Object.assign(
    {
      id: "s1",
      projectToolId: "pt1",
      projectId: "p1",
      toolId: "t1",
      projectName: "示例项目",
      toolName: "OpenCode",
      displayName: "登录功能开发",
      nativeSessionId: "ses_123",
      workingDirectory: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
      projectPathExists: true,
    } satisfies AiSession,
    overrides,
  );
}

function makeCaps(restore: NativeSupport): NativeSessionCapabilities {
  return {
    toolId: "opencode",
    create: "supported",
    list: "supported",
    restore,
    nativeId: "supported",
    renameTitle: "supported",
    delete: "supported",
    history: {
      kind: "service",
      completeness: "fullNative",
      stableNativeId: true,
      readsMessages: false,
      canRestore: true,
      summary: "",
      limitations: "",
    },
    notes: "",
  };
}

describe("getAiSessionState", () => {
  it("项目目录不可用时优先判定为 projectMissing 且不可恢复", () => {
    const state = getAiSessionState(
      makeSession({ projectPathExists: false }),
      makeCaps("supported"),
      { projectPathExists: false },
    );
    expect(state.id).toBe("projectMissing");
    expect(state.canRestore).toBe(false);
    expect(state.tone).toBe("danger");
  });

  it("缺少原生标识时判定为 localOnly 且不可恢复", () => {
    const state = getAiSessionState(
      makeSession({ nativeSessionId: null }),
      makeCaps("supported"),
      { projectPathExists: true },
    );
    expect(state.id).toBe("localOnly");
    expect(state.canRestore).toBe(false);
  });

  it("被标记为原生会话缺失时判定为 missing", () => {
    const state = getAiSessionState(makeSession(), makeCaps("supported"), {
      projectPathExists: true,
      markedMissing: true,
    });
    expect(state.id).toBe("missing");
    expect(state.canRestore).toBe(false);
  });

  it("工具不支持恢复时判定为 unsupported", () => {
    const state = getAiSessionState(makeSession(), makeCaps("unsupported"), {
      projectPathExists: true,
    });
    expect(state.id).toBe("unsupported");
    expect(state.canRestore).toBe(false);
  });

  it("能力尚未核实时不视为支持", () => {
    const state = getAiSessionState(makeSession(), makeCaps("notVerified"), {
      projectPathExists: true,
    });
    expect(state.id).toBe("unsupported");
    expect(state.canRestore).toBe(false);
  });

  it("能力缺失时判定为 unsupported", () => {
    const state = getAiSessionState(makeSession(), null, {
      projectPathExists: true,
    });
    expect(state.id).toBe("unsupported");
  });

  it("一切正常时判定为 ready 且可恢复", () => {
    const state = getAiSessionState(makeSession(), makeCaps("supported"), {
      projectPathExists: true,
    });
    expect(state.id).toBe("ready");
    expect(state.canRestore).toBe(true);
    expect(state.tone).toBe("success");
  });
});
