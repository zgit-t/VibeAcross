import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../context/AppContext";
import { I18nProvider } from "../../i18n";
import { RevisionProvider } from "../../context/RevisionContext";
import type {
  AiSession,
  NativeSessionCapabilities,
  NativeSupport,
  NativeSyncOutcome,
  Project,
  SessionDeleteOutcome,
  ToolEntry,
} from "../../types/domain";
import { RunSessionDialog } from "./RunSessionDialog";

vi.mock("../../services/sessions", () => ({
  sessionCapabilities: vi.fn(),
  listNativeSessions: vi.fn(),
  syncNativeSessions: vi.fn(),
  createNativeSession: vi.fn(),
  restoreNativeSession: vi.fn(),
  renameNativeSession: vi.fn(),
  listSessions: vi.fn(),
  setSessionStatus: vi.fn(),
  deleteSessionScoped: vi.fn(),
}));

vi.mock("../../services/projects", () => ({
  launchProject: vi.fn(),
}));

import * as sessionsApi from "../../services/sessions";
import * as projectsApi from "../../services/projects";

const api = sessionsApi as unknown as {
  sessionCapabilities: ReturnType<typeof vi.fn>;
  syncNativeSessions: ReturnType<typeof vi.fn>;
  createNativeSession: ReturnType<typeof vi.fn>;
  restoreNativeSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  deleteSessionScoped: ReturnType<typeof vi.fn>;
};

const projects = projectsApi as unknown as {
  launchProject: ReturnType<typeof vi.fn>;
};

function capabilities(
  toolId: string,
  overrides: Partial<NativeSessionCapabilities> = {},
): NativeSessionCapabilities {
  return {
    toolId,
    create: "supported",
    list: "supported",
    restore: "supported",
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
    ...overrides,
  };
}

function syncResult(sessions: AiSession[]): NativeSyncOutcome {
  return { state: "available", sessions, skipped: 0 };
}

function deleteOutcome(
  overrides: Partial<SessionDeleteOutcome> = {},
): SessionDeleteOutcome {
  return {
    scope: "local",
    nativeDeleted: false,
    nativeAlreadyGone: false,
    localDeleted: true,
    localCleanupFailed: false,
    localCleanupError: null,
    ...overrides,
  };
}

function tool(id: string, toolId: string, name: string): ToolEntry {
  return {
    id,
    toolId,
    name,
    vendor: "vendor",
    description: "",
    toolType: "cli",
    source: "manual",
    status: "detected",
    executablePath: `C:\\tools\\${name}.exe`,
    commandName: null,
    version: null,
    detectionMethod: null,
    isCustom: false,
    isDefault: false,
    detectedAt: null,
    lastError: null,
    createdAt: null,
    updatedAt: null,
    autoDetectReliable: true,
    detectionNote: "",
    launch: { support: "supported", method: "workingDirectory", reason: "" },
    restore: {
      level: "project",
      levelReason: "",
      session: "unsupported",
      sessionReason: "",
    },
    installed: true,
  };
}

function session(
  id: string,
  toolId: string,
  displayName: string,
  nativeSessionId: string | null = `native-${id}`,
): AiSession {
  return {
    id,
    projectToolId: `pt-${toolId}`,
    projectId: "proj-a",
    toolId,
    projectName: "项目 A",
    toolName: toolId,
    displayName,
    nativeSessionId,
    workingDirectory: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastUsedAt: null,
    projectPathExists: true,
  };
}

const project: Project = {
  id: "proj-a",
  name: "项目 A",
  path: "C:\\proj-a",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastOpenedAt: null,
  description: null,
  isFavorite: false,
  defaultToolId: null,
  pathExists: true,
};

const toolX = tool("install-x", "opencode", "OpenCode");
const toolY = tool("install-y", "claude-code", "Claude Code");

function renderDialog(initialToolId: string) {
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <RunSessionDialog
            open
            project={project}
            tools={[toolX, toolY]}
            initialToolId={initialToolId}
            onClose={() => undefined}
          />
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listSessions.mockResolvedValue([]);
  api.createNativeSession.mockResolvedValue({
    session: session("new", "opencode", "新会话"),
    native: {
      nativeId: "native-new",
      title: null,
      directory: null,
      createdAt: null,
      updatedAt: null,
    },
    launch: null,
    launchError: null,
  });
});

describe("RunSessionDialog 会话隔离与操作", () => {
  it("切换工具只显示该工具的会话，并可恢复指定会话", async () => {
    api.sessionCapabilities.mockImplementation((toolId: string) =>
      Promise.resolve(
        toolId === "opencode"
          ? capabilities("opencode")
          : capabilities("claude-code", {
              list: "unsupported",
              renameTitle: "unsupported",
            }),
      ),
    );
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1"), session("x2", "install-x", "X2")]),
    );
    api.listSessions.mockResolvedValue([session("y1", "install-y", "Y1")]);
    api.restoreNativeSession.mockResolvedValue({});

    renderDialog(toolX.id);

    await screen.findByText("X1");
    expect(screen.getByText("X2")).toBeInTheDocument();
    expect(screen.queryByText("Y1")).not.toBeInTheDocument();
    // 名称被截断时可通过 title 查看完整会话名。
    expect(screen.getByText("X1")).toHaveAttribute("title", "X1");

    // 恢复 X1：调用的应是 X1 的 id，而不是新建。
    const x1Row = screen.getByText("X1").closest("li") as HTMLElement;
    fireEvent.click(within(x1Row).getByRole("button", { name: "继续会话" }));
    await waitFor(() => expect(api.restoreNativeSession).toHaveBeenCalledWith("x1"));
    expect(api.createNativeSession).not.toHaveBeenCalled();

    // 切换到工具 Y：只看到 Y1。
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: toolY.id } });
    await screen.findByText("Y1");
    expect(screen.queryByText("X1")).not.toBeInTheDocument();
    expect(screen.queryByText("X2")).not.toBeInTheDocument();
    expect(api.listSessions).toHaveBeenCalledWith({
      projectId: "proj-a",
      toolId: toolY.id,
    });
  });

  it("重复点击新建只触发一次创建请求", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(syncResult([]));
    // 创建请求永不落定，模拟进行中。
    let resolveCreate: (value: unknown) => void = () => undefined;
    api.createNativeSession.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderDialog(toolX.id);

    fireEvent.click(await screen.findByRole("button", { name: "新建会话" }));
    const nameInput = screen.getByLabelText("会话名称");
    fireEvent.change(nameInput, { target: { value: "只应创建一个" } });

    const createButton = screen.getByRole("button", { name: "创建并进入" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(api.createNativeSession).toHaveBeenCalledTimes(1);

    resolveCreate({
      session: session("new", "install-x", "只应创建一个"),
      native: {
        nativeId: "native-new",
        title: null,
        directory: null,
        createdAt: null,
        updatedAt: null,
      },
      launch: null,
      launchError: null,
    });
  });

  it("加载过程中切换工具，丢弃过期结果，不覆盖新工具会话", async () => {
    api.sessionCapabilities.mockImplementation((toolId: string) =>
      Promise.resolve(capabilities(toolId)),
    );
    // X 的会话查询挂起，Y 立即返回。
    let resolveX: (value: NativeSyncOutcome) => void = () => undefined;
    api.syncNativeSessions.mockImplementation((_projectId: string, toolId: string) => {
      if (toolId === toolX.id) {
        return new Promise<NativeSyncOutcome>((resolve) => {
          resolveX = resolve;
        });
      }
      return Promise.resolve(syncResult([session("y1", "install-y", "Y1")]));
    });

    renderDialog(toolX.id);

    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: toolY.id } });

    await screen.findByText("Y1");

    // 迟到的 X 结果不得覆盖当前工具 Y 的列表。
    resolveX(syncResult([session("x1", "install-x", "X1")]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("X1")).not.toBeInTheDocument();
    expect(screen.getByText("Y1")).toBeInTheDocument();
  });

  it("工具能力为「尚未核实」时不提供创建入口", async () => {
    const notVerified: NativeSupport = "notVerified";
    api.sessionCapabilities.mockResolvedValue(
      capabilities("claude-code", { create: notVerified, list: "unsupported" }),
    );
    api.listSessions.mockResolvedValue([]);

    renderDialog(toolY.id);

    await screen.findByText("当前工具不支持创建会话");

    expect(screen.getByRole("button", { name: "新建会话" })).toBeDisabled();
  });

  it("历史来源不存在时如实提示来源缺失，而不是显示为空列表", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue({
      state: "sourceMissing",
      sessions: [],
    });

    renderDialog(toolX.id);

    await screen.findByText("未发现历史来源");
    // 「没有历史会话」与「来源不存在」必须区分，不得把后者说成空列表。
    expect(screen.queryByText("还没有历史会话")).not.toBeInTheDocument();
  });

  it("历史结构不受支持时给出明确说明", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("trae"));
    api.syncNativeSessions.mockResolvedValue({
      state: "structureUnsupported",
      sessions: [],
    });

    renderDialog(toolX.id);

    await screen.findByText("历史结构暂不受支持");
  });

  it("创建不受支持但可启动的工具仍提供「打开工具」入口", async () => {
    api.sessionCapabilities.mockResolvedValue(
      capabilities("claude-code", { create: "unsupported", list: "unsupported" }),
    );
    api.listSessions.mockResolvedValue([]);

    renderDialog(toolY.id);

    await screen.findByText("当前工具不支持创建会话");
    expect(screen.getByRole("button", { name: "新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开工具" })).toBeEnabled();
  });

  it("「打开工具」只调用启动接口并如实反馈，不会创建会话", async () => {
    api.sessionCapabilities.mockResolvedValue(
      capabilities("claude-code", { create: "unsupported", list: "unsupported" }),
    );
    api.listSessions.mockResolvedValue([]);
    projects.launchProject.mockResolvedValue({
      projectId: "proj-a",
      projectName: "项目 A",
      toolId: toolY.id,
      toolName: "Claude Code",
      pid: 123,
      method: "workingDirectory",
      workingDir: "C:\\proj-a",
      arguments: [],
      contextInitialized: false,
    });

    renderDialog(toolY.id);

    fireEvent.click(await screen.findByRole("button", { name: "打开工具" }));

    await waitFor(() =>
      expect(projects.launchProject).toHaveBeenCalledWith("proj-a", toolY.id),
    );
    await screen.findByText(/已在项目目录中打开「Claude Code」/);
    expect(api.createNativeSession).not.toHaveBeenCalled();
  });

  it("在运行会话界面删除本地记录后移除该行", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockResolvedValue(deleteOutcome());

    renderDialog(toolX.id);

    await screen.findByText("X1");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog", { name: "删除会话" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "删除本地记录" }),
    );

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "local"),
    );
    await waitFor(() =>
      expect(screen.queryByText("X1")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/已删除会话「X1」的本地记录/),
    ).toBeInTheDocument();
  });

  it("原生删除在运行会话界面同样需要二次确认", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockResolvedValue(
      deleteOutcome({
        scope: "native",
        nativeDeleted: true,
        localDeleted: false,
      }),
    );

    renderDialog(toolX.id);

    await screen.findByText("X1");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog", { name: "删除会话" });
    fireEvent.click(
      within(dialog).getByRole("radio", {
        name: /仅删除 AI 工具中的会话/,
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "继续" }));
    expect(api.deleteSessionScoped).not.toHaveBeenCalled();

    const confirm = await screen.findByRole("dialog", {
      name: "确认删除原生会话",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "native"),
    );
    expect(await screen.findByText("原生会话已删除")).toBeInTheDocument();
    expect(screen.getByText("X1")).toBeInTheDocument();
  });
});

describe("RunSessionDialog 加载状态", () => {
  it("读取历史会话时显示加载动画，完成后结束并展示列表", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    let resolveSync: (value: NativeSyncOutcome) => void = () => undefined;
    api.syncNativeSessions.mockReturnValue(
      new Promise<NativeSyncOutcome>((resolve) => {
        resolveSync = resolve;
      }),
    );

    renderDialog(toolX.id);

    // 请求未完成：显示轻量加载动画与文案（不显示空状态 / 错误）。
    const label = await screen.findByText("正在读取会话…");
    const status = label.closest('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("还没有历史会话")).not.toBeInTheDocument();

    resolveSync(syncResult([session("x1", "install-x", "X1")]));

    expect(await screen.findByText("X1")).toBeInTheDocument();
    expect(screen.queryByText("正在读取会话…")).not.toBeInTheDocument();
    expect(api.createNativeSession).not.toHaveBeenCalled();
    expect(api.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("返回空列表时显示空状态，而不是加载失败", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(syncResult([]));

    renderDialog(toolX.id);

    expect(await screen.findByText("还没有历史会话")).toBeInTheDocument();
    expect(screen.queryByText("正在读取会话…")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
  });

  it("读取失败时显示错误与重试入口，重试期间回到加载状态并重新读取", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    let resolveRetry: (value: NativeSyncOutcome) => void = () => undefined;
    api.syncNativeSessions
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(
        () =>
          new Promise<NativeSyncOutcome>((resolve) => {
            resolveRetry = resolve;
          }),
      );

    renderDialog(toolX.id);

    // 失败：不能一直显示动画，也不能把失败说成空列表。
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("正在读取会话…")).not.toBeInTheDocument();
    expect(screen.queryByText("还没有历史会话")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    // 重试期间重新显示加载动画。
    expect(await screen.findByText("正在读取会话…")).toBeInTheDocument();

    resolveRetry(syncResult([session("x1", "install-x", "X1")]));

    expect(await screen.findByText("X1")).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(api.syncNativeSessions).toHaveBeenCalledTimes(2);
    // 重试只重新读取，不新建、不恢复。
    expect(api.createNativeSession).not.toHaveBeenCalled();
    expect(api.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("同一查询进行中重复触发（工具数组更新）不会重复读取", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    let resolveSync: (value: NativeSyncOutcome) => void = () => undefined;
    api.syncNativeSessions.mockReturnValue(
      new Promise<NativeSyncOutcome>((resolve) => {
        resolveSync = resolve;
      }),
    );

    const view = renderDialog(toolX.id);
    await waitFor(() => expect(api.syncNativeSessions).toHaveBeenCalledTimes(1));

    // 用新的工具数组引用触发加载 effect 重跑（模拟父组件重渲染）。
    view.rerender(
      <AppProvider>
        <I18nProvider>
          <RevisionProvider>
            <RunSessionDialog
              open
              project={project}
              tools={[toolX, toolY]}
              initialToolId={toolX.id}
              onClose={() => undefined}
            />
          </RevisionProvider>
        </I18nProvider>
      </AppProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.syncNativeSessions).toHaveBeenCalledTimes(1);
    expect(api.sessionCapabilities).toHaveBeenCalledTimes(1);

    resolveSync(syncResult([session("x1", "install-x", "X1")]));
    expect(await screen.findByText("X1")).toBeInTheDocument();
  });

  it("StrictMode 二次挂载也只读取一次", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );

    render(
      <StrictMode>
        <AppProvider>
          <I18nProvider>
            <RevisionProvider>
              <RunSessionDialog
                open
                project={project}
                tools={[toolX, toolY]}
                initialToolId={toolX.id}
                onClose={() => undefined}
              />
            </RevisionProvider>
          </I18nProvider>
        </AppProvider>
      </StrictMode>,
    );

    expect(await screen.findByText("X1")).toBeInTheDocument();
    expect(api.syncNativeSessions).toHaveBeenCalledTimes(1);
    expect(api.sessionCapabilities).toHaveBeenCalledTimes(1);
  });

  it("有旧项目遗留的原生会话被跳过时如实提示，不谎称已纳入", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue({
      state: "available",
      sessions: [],
      skipped: 2,
    });

    renderDialog(toolX.id);

    expect(
      await screen.findByText("部分历史会话未纳入本项目"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/有 2 条历史会话原属于已被移除的项目/),
    ).toBeInTheDocument();
  });
});
