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
  return { state: "available", sessions };
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

  it("默认选中「仅删除 VibeAcross 中的记录」，并仅按所选范围执行", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockResolvedValue({
      scope: "local",
      nativeDeleted: false,
      nativeAlreadyGone: false,
      localDeleted: true,
    });

    renderDialog(toolX.id);

    const row = (await screen.findByText("X1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));

    // 对话框展示会话名称与三种范围。
    expect(
      await screen.findByText(/确定要删除会话「X1」吗/),
    ).toBeInTheDocument();
    const local = screen.getByRole("radio", {
      name: /仅删除 VibeAcross 中的记录/,
    });
    const native = screen.getByRole("radio", {
      name: /仅删除 AI 工具中的会话/,
    });
    const both = screen.getByRole("radio", { name: /同时删除两者/ });
    // 默认选中风险最低的「仅本地记录」，不得默认选中会删除原生会话的选项。
    expect(local).toBeChecked();
    expect(native).not.toBeChecked();
    expect(both).not.toBeChecked();
    expect(api.deleteSessionScoped).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "local"),
    );
    await waitFor(() =>
      expect(screen.queryByText("X1")).not.toBeInTheDocument(),
    );
  });

  it("选择「仅删除 AI 工具中的会话」时保留本地记录并标记为已不存在", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockResolvedValue({
      scope: "native",
      nativeDeleted: true,
      nativeAlreadyGone: false,
      localDeleted: false,
    });

    renderDialog(toolX.id);

    const row = (await screen.findByText("X1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));
    await screen.findByText(/确定要删除会话「X1」吗/);

    fireEvent.click(
      screen.getByRole("radio", { name: /仅删除 AI 工具中的会话/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "native"),
    );
    // 本地记录保留 → 行仍在，并标记为「会话已不存在」。
    expect(screen.getByText("X1")).toBeInTheDocument();
    expect(await screen.findByText("会话已不存在")).toBeInTheDocument();
  });

  it("选择「同时删除两者」时按 both 范围执行并移除本地记录", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockResolvedValue({
      scope: "both",
      nativeDeleted: true,
      nativeAlreadyGone: false,
      localDeleted: true,
    });

    renderDialog(toolX.id);

    const row = (await screen.findByText("X1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));
    await screen.findByText(/确定要删除会话「X1」吗/);

    fireEvent.click(screen.getByRole("radio", { name: /同时删除两者/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "both"),
    );
    await waitFor(() =>
      expect(screen.queryByText("X1")).not.toBeInTheDocument(),
    );
  });

  it("不支持原生删除的工具会禁用原生相关选项并说明原因", async () => {
    api.sessionCapabilities.mockResolvedValue(
      capabilities("claude-code", {
        list: "unsupported",
        delete: "unsupported",
      }),
    );
    api.listSessions.mockResolvedValue([session("y1", "install-y", "Y1")]);

    renderDialog(toolY.id);

    const row = (await screen.findByText("Y1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));

    await screen.findByText(/确定要删除会话「Y1」吗/);
    // 仅本地可用；原生相关选项禁用并给出原因。
    expect(
      screen.getByRole("radio", { name: /仅删除 VibeAcross 中的记录/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("radio", { name: /仅删除 AI 工具中的会话/ }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: /同时删除两者/ })).toBeDisabled();
    expect(screen.getAllByText(/暂不支持删除原生会话/).length).toBe(2);
  });

  it("原生删除失败时不清理本地记录并如实显示错误", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );
    api.deleteSessionScoped.mockRejectedValue(
      Object.assign(new Error("删除原生会话失败（HTTP 500）。"), {
        code: "NATIVE_DELETE_FAILED",
      }),
    );

    renderDialog(toolX.id);

    const row = (await screen.findByText("X1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));
    await screen.findByText(/确定要删除会话「X1」吗/);

    fireEvent.click(screen.getByRole("radio", { name: /同时删除两者/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(api.deleteSessionScoped).toHaveBeenCalledWith("x1", "both"),
    );
    // 本地记录保留，行仍在，且显示错误。
    await screen.findByText(/删除原生会话失败/);
    expect(screen.getByText("X1")).toBeInTheDocument();
  });

  it("取消确认不执行任何删除操作", async () => {
    api.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
    api.syncNativeSessions.mockResolvedValue(
      syncResult([session("x1", "install-x", "X1")]),
    );

    renderDialog(toolX.id);

    const row = (await screen.findByText("X1")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除会话" }));
    await screen.findByText(/确定要删除会话「X1」吗/);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(
        screen.queryByText(/确定要删除会话「X1」吗/),
      ).not.toBeInTheDocument(),
    );
    expect(api.deleteSessionScoped).not.toHaveBeenCalled();
    expect(screen.getByText("X1")).toBeInTheDocument();
  });
});
