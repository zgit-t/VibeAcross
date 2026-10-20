import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../context/AppContext";
import { I18nProvider } from "../../i18n";
import { RevisionProvider } from "../../context/RevisionContext";
import { ToolsProvider } from "../../context/ToolsContext";
import type {
  AiSession,
  NativeSessionCapabilities,
  NativeSyncOutcome,
  Project,
  ProjectTool,
  ToolEntry,
} from "../../types/domain";
import { RunSessionFlow } from "./RunSessionFlow";

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

vi.mock("../../services/projectTools", () => ({
  listProjectTools: vi.fn(),
  addProjectTool: vi.fn(),
  removeProjectTool: vi.fn(),
}));

vi.mock("../../services/tools", () => ({
  listTools: vi.fn(),
}));

import * as sessionsApi from "../../services/sessions";
import * as projectToolsApi from "../../services/projectTools";
import * as toolsApi from "../../services/tools";

const sessions = sessionsApi as unknown as {
  sessionCapabilities: ReturnType<typeof vi.fn>;
  syncNativeSessions: ReturnType<typeof vi.fn>;
  createNativeSession: ReturnType<typeof vi.fn>;
  restoreNativeSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
};
const projectTools = projectToolsApi as unknown as {
  listProjectTools: ReturnType<typeof vi.fn>;
};
const toolsApiMock = toolsApi as unknown as {
  listTools: ReturnType<typeof vi.fn>;
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

function projectTool(id: string, toolId: string): ProjectTool {
  return {
    id,
    projectId: "proj-a",
    toolId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sessionCount: 0,
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
  defaultToolId: "install-x",
  pathExists: true,
};

const toolX = tool("install-x", "opencode", "OpenCode");
const toolY = tool("install-y", "claude-code", "Claude Code");

function renderFlow(initialToolId: string, onClose: () => void = () => undefined) {
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <ToolsProvider>
            <RunSessionFlow
              open
              project={project}
              initialToolId={initialToolId}
              onClose={onClose}
            />
          </ToolsProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  toolsApiMock.listTools.mockResolvedValue({
    entries: [toolX, toolY],
    lastDetectionAt: null,
  });
  projectTools.listProjectTools.mockResolvedValue([
    projectTool("pt-x", "install-x"),
    projectTool("pt-y", "install-y"),
  ]);
  sessions.sessionCapabilities.mockResolvedValue(capabilities("opencode"));
  sessions.syncNativeSessions.mockResolvedValue(syncResult([]));
  sessions.listSessions.mockResolvedValue([]);
  sessions.createNativeSession.mockResolvedValue({
    session: session("new", "install-x", "新会话"),
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
  sessions.restoreNativeSession.mockResolvedValue({});
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("运行会话：直接进入统一界面", () => {
  it("点击运行直接展示历史会话与新建按钮，不再有前置二选一", async () => {
    renderFlow(toolX.id);

    // 直接进入会话界面：查询该项目 + 该工具的历史会话。
    await waitFor(() =>
      expect(sessions.syncNativeSessions).toHaveBeenCalledWith(
        "proj-a",
        "install-x",
      ),
    );

    // 空状态 + 新建按钮同屏。
    expect(await screen.findByText("还没有历史会话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建会话/ })).toBeInTheDocument();

    // 不再出现旧的入口二选一。
    expect(screen.queryByText("进入历史会话")).not.toBeInTheDocument();

    // 仅查询了历史会话，未创建也未恢复。
    expect(sessions.sessionCapabilities).toHaveBeenCalledWith("opencode");
    expect(sessions.createNativeSession).not.toHaveBeenCalled();
    expect(sessions.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("默认列出该项目 + 该工具的历史会话，并进入现有恢复流程", async () => {
    sessions.syncNativeSessions.mockResolvedValue(
      syncResult([
        session("x1", "install-x", "X1"),
        session("x2", "install-x", "X2"),
      ]),
    );

    renderFlow(toolX.id);

    await screen.findByText("X1");
    expect(screen.getByText("X2")).toBeInTheDocument();
    expect(sessions.syncNativeSessions).toHaveBeenCalledWith("proj-a", "install-x");

    const row = screen.getByText("X1").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "继续会话" }));

    await waitFor(() =>
      expect(sessions.restoreNativeSession).toHaveBeenCalledWith("x1"),
    );
    expect(sessions.createNativeSession).not.toHaveBeenCalled();
  });

  it("在同一界面点击「新建会话」走现有创建流程", async () => {
    renderFlow(toolX.id);

    const newButton = await screen.findByRole("button", { name: /新建会话/ });
    await waitFor(() => expect(newButton).toBeEnabled());
    fireEvent.click(newButton);

    const submit = await screen.findByRole("button", { name: "创建并进入" });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(sessions.createNativeSession).toHaveBeenCalledTimes(1),
    );
    expect(sessions.createNativeSession).toHaveBeenCalledWith({
      projectId: "proj-a",
      toolId: "install-x",
      displayName: null,
      launch: true,
    });
    expect(sessions.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("关闭界面不会创建或恢复任何会话", async () => {
    const onClose = vi.fn();
    renderFlow(toolX.id, onClose);

    await screen.findByText("还没有历史会话");
    // 弹窗右上角与底部各有一个「关闭」，点击底部主按钮。
    const closeButtons = screen.getAllByRole("button", { name: "关闭" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessions.createNativeSession).not.toHaveBeenCalled();
    expect(sessions.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("工具不支持创建时禁用新建按钮并如实提示", async () => {
    sessions.sessionCapabilities.mockResolvedValue(
      capabilities("claude-code", {
        create: "unsupported",
        list: "unsupported",
        restore: "unsupported",
      }),
    );

    renderFlow(toolY.id);

    expect(
      await screen.findByRole("button", { name: /新建会话/ }),
    ).toBeDisabled();
    expect(await screen.findByText(/不支持创建会话/)).toBeInTheDocument();
  });

  it("历史会话加载失败时提示错误，而不是当作空状态", async () => {
    sessions.syncNativeSessions.mockRejectedValue(new Error("boom"));

    renderFlow(toolX.id);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("还没有历史会话")).not.toBeInTheDocument();
  });

  it("切换工具后列出该工具的会话", async () => {
    sessions.syncNativeSessions.mockImplementation(
      (_projectId: string, toolId: string) =>
        Promise.resolve(
          toolId === "install-x"
            ? syncResult([session("x1", "install-x", "X1")])
            : syncResult([session("y1", "install-y", "Y1")]),
        ),
    );

    renderFlow(toolX.id);

    await screen.findByText("X1");

    fireEvent.change(screen.getByLabelText("切换工具"), {
      target: { value: "install-y" },
    });

    await screen.findByText("Y1");
    expect(screen.queryByText("X1")).not.toBeInTheDocument();
    expect(sessions.syncNativeSessions).toHaveBeenLastCalledWith(
      "proj-a",
      "install-y",
    );
  });

  it("项目未关联任何工具且未设置默认工具时，仍立即展示全部已识别工具", async () => {
    // 项目侧没有任何关联记录，默认工具也为空：工具列表仍须来自统一的检测结果。
    projectTools.listProjectTools.mockResolvedValue([]);

    render(
      <AppProvider>
        <I18nProvider>
          <RevisionProvider>
            <ToolsProvider>
              <RunSessionFlow
                open
                project={{ ...project, defaultToolId: null }}
                initialToolId={null}
                onClose={() => undefined}
              />
            </ToolsProvider>
          </RevisionProvider>
        </I18nProvider>
      </AppProvider>,
    );

    const select = await screen.findByLabelText("切换工具");
    expect(
      within(select).getByRole("option", { name: "OpenCode" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Claude Code" }),
    ).toBeInTheDocument();
    // 默认选中第一个已识别工具，无需先手动切换。
    await waitFor(() =>
      expect(sessions.syncNativeSessions).toHaveBeenCalledWith(
        "proj-a",
        "install-x",
      ),
    );
  });
});
