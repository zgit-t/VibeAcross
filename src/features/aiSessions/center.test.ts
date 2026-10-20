import { describe, expect, it } from "vitest";
import type { AiSession } from "../../types/domain";
import {
  compareSessionsByActivity,
  dedupeSessions,
  filterSessions,
  sessionActivitySource,
  sessionActivityTime,
  sessionDisplayName,
  sortSessions,
} from "./center";

function makeSession(overrides: Partial<AiSession> = {}): AiSession {
  return Object.assign(
    {
      id: "s1",
      projectToolId: "pt1",
      projectId: "p1",
      toolId: "t1",
      projectName: "项目 A",
      toolName: "OpenCode",
      displayName: "登录功能开发",
      nativeSessionId: "native-1",
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

describe("sessionActivityTime", () => {
  it("优先使用 lastUsedAt，缺失时回退到 updatedAt", () => {
    expect(
      sessionActivityTime(
        makeSession({
          lastUsedAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-05-01T00:00:00.000Z");
    expect(
      sessionActivityTime(
        makeSession({
          lastUsedAt: null,
          updatedAt: "2026-02-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-02-01T00:00:00.000Z");
  });

  it("lastUsedAt 无效或空白时回退到 updatedAt", () => {
    const fallback = "2026-02-01T00:00:00.000Z";
    expect(
      sessionActivityTime(
        makeSession({ lastUsedAt: "not-a-date", updatedAt: fallback }),
      ),
    ).toBe(fallback);
    expect(
      sessionActivityTime(
        makeSession({ lastUsedAt: "   ", updatedAt: fallback }),
      ),
    ).toBe(fallback);
  });
});

describe("sessionActivitySource", () => {
  it("依据是否存在有效的最近使用时间返回来源", () => {
    expect(
      sessionActivitySource(makeSession({ lastUsedAt: "2026-05-01T00:00:00.000Z" })),
    ).toBe("lastUsedAt");
    expect(sessionActivitySource(makeSession({ lastUsedAt: null }))).toBe(
      "updatedAt",
    );
    expect(
      sessionActivitySource(
        makeSession({ lastUsedAt: "bad", updatedAt: "2026-02-01T00:00:00.000Z" }),
      ),
    ).toBe("updatedAt");
    expect(
      sessionActivitySource(
        makeSession({ lastUsedAt: "bad", updatedAt: "also-bad" }),
      ),
    ).toBe("none");
  });
});

describe("dedupeSessions", () => {
  it("合并同一工具下原生标识相同的记录，保留活动时间最新的一条", () => {
    const deduped = dedupeSessions([
      makeSession({
        id: "older",
        toolId: "t1",
        nativeSessionId: "n1",
        displayName: "旧记录",
        lastUsedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeSession({
        id: "newer",
        toolId: "t1",
        nativeSessionId: "n1",
        displayName: "新记录",
        lastUsedAt: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("newer");
  });

  it("不同工具下相同的原生标识不会被合并", () => {
    const deduped = dedupeSessions([
      makeSession({ id: "a", toolId: "t1", nativeSessionId: "n1" }),
      makeSession({ id: "b", toolId: "t2", nativeSessionId: "n1" }),
    ]);
    expect(deduped).toHaveLength(2);
  });

  it("名称相同但缺少原生标识的记录不会被合并", () => {
    const deduped = dedupeSessions([
      makeSession({ id: "a", nativeSessionId: null, displayName: "同名" }),
      makeSession({ id: "b", nativeSessionId: null, displayName: "同名" }),
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("sessionDisplayName", () => {
  it("名称缺失时使用统一的备用名称，绝不使用项目名", () => {
    expect(
      sessionDisplayName(
        makeSession({ displayName: "  ", nativeSessionId: "n1" }),
        "未命名会话",
      ),
    ).toBe("未命名会话");
    expect(
      sessionDisplayName(makeSession({ displayName: "标题" }), "未命名会话"),
    ).toBe("标题");
  });
});

describe("filterSessions", () => {
  const sessions = [
    makeSession({
      id: "a",
      displayName: "登录功能开发",
      projectId: "p1",
      projectName: "项目 A",
      toolId: "t1",
      toolName: "OpenCode",
    }),
    makeSession({
      id: "b",
      displayName: "支付重构",
      projectId: "p2",
      projectName: "项目 B",
      toolId: "t2",
      toolName: "Cursor",
      nativeSessionId: "n2",
    }),
  ];

  it("按名称、项目名或工具名搜索（不区分大小写）", () => {
    expect(filterSessions(sessions, { search: "登录", projectId: null, toolId: null })).toHaveLength(1);
    expect(filterSessions(sessions, { search: "项目 b", projectId: null, toolId: null })).toHaveLength(1);
    expect(filterSessions(sessions, { search: "cursor", projectId: null, toolId: null })).toHaveLength(1);
    expect(filterSessions(sessions, { search: "zzz", projectId: null, toolId: null })).toHaveLength(0);
  });

  it("按项目与工具筛选可叠加生效", () => {
    expect(filterSessions(sessions, { search: "", projectId: "p2", toolId: null })).toHaveLength(1);
    expect(filterSessions(sessions, { search: "", projectId: null, toolId: "t1" })).toHaveLength(1);
    expect(filterSessions(sessions, { search: "", projectId: "p1", toolId: "t2" })).toHaveLength(0);
  });
});

describe("sortSessions", () => {
  it("默认按活动时间倒序，按名称时升序排列", () => {
    const sessions = [
      makeSession({ id: "b", displayName: "B 会话", lastUsedAt: "2026-01-01T00:00:00.000Z" }),
      makeSession({ id: "a", displayName: "A 会话", lastUsedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(sortSessions(sessions, "activity").map((s) => s.id)).toEqual(["a", "b"]);
    expect(sortSessions(sessions, "name").map((s) => s.displayName)).toEqual([
      "A 会话",
      "B 会话",
    ]);
  });

  it("排序不修改入参数组", () => {
    const sessions = [
      makeSession({ id: "b", lastUsedAt: "2026-01-01T00:00:00.000Z" }),
      makeSession({ id: "a", lastUsedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const before = sessions.map((s) => s.id);
    sortSessions(sessions, "activity");
    expect(sessions.map((s) => s.id)).toEqual(before);
  });
});

describe("compareSessionsByActivity", () => {
  it("活动时间相同时以更新时间、随后以 id 兜底", () => {
    const a = makeSession({ id: "a", lastUsedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = makeSession({ id: "b", lastUsedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(compareSessionsByActivity(a, b)).toBeLessThan(0);
  });

  it("无效 / 缺失时间排在有效时间之后，排序稳定", () => {
    const valid = makeSession({
      id: "valid",
      lastUsedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const invalid = makeSession({
      id: "invalid",
      lastUsedAt: "not-a-date",
      updatedAt: "not-a-date",
    });
    expect(compareSessionsByActivity(valid, invalid)).toBeLessThan(0);
    expect(compareSessionsByActivity(invalid, valid)).toBeGreaterThan(0);
    expect(
      sortSessions([invalid, valid], "activity").map((s) => s.id),
    ).toEqual(["valid", "invalid"]);
  });
});
