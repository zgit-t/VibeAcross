import { useEffect } from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../context/AppContext";
import { ProjectsProvider } from "../context/ProjectsContext";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import { WorkspaceProvider } from "../context/WorkspaceContext";
import { I18nProvider } from "../i18n";
import { setLocale } from "../i18n/locale";
import { OverviewPage } from "./OverviewPage";
import type { AiSession, Project, ToolEntry } from "../types/domain";

vi.mock("../services/projects", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  importProject: vi.fn(),
  renameProject: vi.fn(),
  updateProjectDescription: vi.fn(),
  setProjectFavorite: vi.fn(),
  touchProjectOpened: vi.fn(),
  relocateProject: vi.fn(),
  removeProject: vi.fn(),
  setProjectTool: vi.fn(),
  launchProject: vi.fn(),
  checkProjectHealth: vi.fn(),
  openProjectDir: vi.fn(),
}));

vi.mock("../services/projectTools", () => ({
  listProjectTools: vi.fn(),
  addProjectTool: vi.fn(),
  removeProjectTool: vi.fn(),
}));

vi.mock("../services/tasks", () => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  taskStats: vi.fn(),
}));

vi.mock("../services/tools", () => ({
  listTools: vi.fn(),
  detectTools: vi.fn(),
  addTool: vi.fn(),
  updateTool: vi.fn(),
  removeTool: vi.fn(),
  revalidateTool: vi.fn(),
  setDefaultTool: vi.fn(),
}));

vi.mock("../services/sessions", () => ({
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

vi.mock("../services/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getStorageInfo: vi.fn(),
}));

vi.mock("../services/clipboard", () => ({
  copyText: vi.fn(),
}));

vi.mock("../services/dialog", () => ({
  pickDirectory: vi.fn(),
}));

vi.mock("../services/workspace", () => ({
  listWorkspaceSessions: vi.fn(),
  lastWorkspaceSession: vi.fn(),
  createWorkspaceSession: vi.fn(),
  updateWorkspaceSession: vi.fn(),
  deleteWorkspaceSession: vi.fn(),
  restoreWorkspaceSession: vi.fn(),
}));

import * as projectsService from "../services/projects";
import * as tasksService from "../services/tasks";
import * as toolsService from "../services/tools";
import * as sessionsService from "../services/sessions";
import * as settingsService from "../services/settings";
import * as workspaceService from "../services/workspace";

const projectsApi = projectsService as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
  openProjectDir: ReturnType<typeof vi.fn>;
  setProjectFavorite: ReturnType<typeof vi.fn>;
  setProjectTool: ReturnType<typeof vi.fn>;
  launchProject: ReturnType<typeof vi.fn>;
};
const tasksApi = tasksService as unknown as {
  taskStats: ReturnType<typeof vi.fn>;
};
const toolsApi = toolsService as unknown as {
  listTools: ReturnType<typeof vi.fn>;
};
const sessionsApi = sessionsService as unknown as {
  sessionCapabilities: ReturnType<typeof vi.fn>;
  syncNativeSessions: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  listNativeSessions: ReturnType<typeof vi.fn>;
  createNativeSession: ReturnType<typeof vi.fn>;
  restoreNativeSession: ReturnType<typeof vi.fn>;
  renameNativeSession: ReturnType<typeof vi.fn>;
};
const settingsApi = settingsService as unknown as {
  getSettings: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
};
const workspaceApi = workspaceService as unknown as {
  listWorkspaceSessions: ReturnType<typeof vi.fn>;
};

const EMPTY_SETTINGS = {
  defaultProjectFolder: null,
  theme: null,
  showLastContextOnStartup: true,
  autoRestoreLastContext: false,
  language: null,
  autoUpdate: false,
};

function project(overrides: Partial<Project> = {}): Project {
  return {
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

function session(overrides: Partial<AiSession> = {}): AiSession {
  return {
    id: "session-1",
    projectToolId: "pt-a",
    projectId: "proj-a",
    toolId: "install-x",
    projectName: "项目 A",
    toolName: "OpenCode",
    displayName: "会话一",
    nativeSessionId: "native-1",
    workingDirectory: "C:\\proj-a",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    lastUsedAt: "2026-01-02T00:00:00Z",
    projectPathExists: true,
    ...overrides,
  };
}

function PendingProbe() {
  const { pendingProjectId } = useApp();
  return <span data-testid="pending-project">{pendingProjectId ?? ""}</span>;
}

function UseLanguage({ locale }: { locale: "zh-CN" | "en-US" }) {
  const { setLanguage } = useApp();
  useEffect(() => {
    setLanguage(locale);
  }, [locale, setLanguage]);
  return null;
}

function renderPage(extra?: ReactNode) {
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <WorkspaceProvider>
            <ProjectsProvider>
              <ToolsProvider>
                {extra}
                <PendingProbe />
                <OverviewPage />
              </ToolsProvider>
            </ProjectsProvider>
          </WorkspaceProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

async function openSessionDialog() {
  const rows = await screen.findAllByRole("button", { name: "打开会话" });
  fireEvent.click(rows[0]);
  return screen.findByRole("dialog");
}

async function confirmButton(dialog: HTMLElement) {
  const button = within(dialog).getByRole("button", { name: "确认打开" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setLocale("zh-CN");
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  projectsApi.listProjects.mockResolvedValue([]);
  projectsApi.openProjectDir.mockResolvedValue(undefined);
  projectsApi.setProjectFavorite.mockResolvedValue(undefined);
  projectsApi.setProjectTool.mockResolvedValue(undefined);
  tasksApi.taskStats.mockResolvedValue({
    todo: 0,
    inProgress: 0,
    done: 0,
    total: 0,
  });
  toolsApi.listTools.mockResolvedValue({ entries: [], lastDetectionAt: null });
  workspaceApi.listWorkspaceSessions.mockResolvedValue([]);
  settingsApi.getSettings.mockResolvedValue(EMPTY_SETTINGS);
  settingsApi.updateSettings.mockImplementation(async (value: unknown) => value);
  sessionsApi.listSessions.mockResolvedValue([]);
  sessionsApi.sessionCapabilities.mockImplementation(async (toolId: string) => ({
    toolId,
    create: "unsupported",
    list: "supported",
    restore: toolId === "opencode" ? "supported" : "unsupported",
    nativeId: "supported",
    renameTitle: "unsupported",
    delete: "unsupported",
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
  }));
  sessionsApi.syncNativeSessions.mockResolvedValue({
    state: "available",
    sessions: [],
  });
  sessionsApi.listNativeSessions.mockResolvedValue([]);
  sessionsApi.createNativeSession.mockResolvedValue({});
  sessionsApi.restoreNativeSession.mockResolvedValue({});
  sessionsApi.renameNativeSession.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("概览：最近会话", () => {
  it("渲染真实会话记录，展示所属项目与工具", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    expect(await screen.findByText("会话一")).toBeInTheDocument();
    expect(screen.getByText("项目 A")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
  });

  it("按最近活动时间倒序排列", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "old",
        displayName: "旧会话",
        lastUsedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      session({
        id: "new",
        displayName: "新会话",
        lastUsedAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      }),
    ]);

    renderPage();

    await screen.findByText("新会话");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("新会话");
    expect(items[1]).toHaveTextContent("旧会话");
  });

  it("没有会话记录时展示空状态", async () => {
    sessionsApi.listSessions.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("还没有会话记录")).toBeInTheDocument();
  });

  it("读取失败时展示错误并可重试", async () => {
    sessionsApi.listSessions.mockRejectedValueOnce(undefined).mockResolvedValue(
      [],
    );

    renderPage();

    expect(await screen.findByText("读取会话列表失败。")).toBeInTheDocument();
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
  });

  function availableSetup() {
    projectsApi.listProjects.mockResolvedValue([project()]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-x", "opencode", "OpenCode")],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([session()]);
  }

  it("点击「打开会话」只显示确认框，不立即启动工具", async () => {
    availableSetup();

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开会话" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "打开历史会话" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("会话一")).toBeInTheDocument();
    expect(within(dialog).getByText("项目 A")).toBeInTheDocument();
    expect(within(dialog).getByText("OpenCode")).toBeInTheDocument();

    // 仅展示确认框：不启动工具、不恢复、不创建、不进入运行流程。
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.createNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
    expect(projectsApi.launchProject).not.toHaveBeenCalled();
  });

  it("点击取消不调用任何启动 / 恢复 / 创建接口", async () => {
    availableSetup();

    renderPage();

    const dialog = await openSessionDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.createNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
    expect(projectsApi.launchProject).not.toHaveBeenCalled();
  });

  it("确认打开调用对应工具的原生会话接口并传入该 session id", async () => {
    availableSetup();

    renderPage();

    const dialog = await openSessionDialog();
    fireEvent.click(await confirmButton(dialog));

    await waitFor(() =>
      expect(sessionsApi.restoreNativeSession).toHaveBeenCalledWith(
        "session-1",
      ),
    );
    expect(sessionsApi.restoreNativeSession).toHaveBeenCalledTimes(1);
    // 不进入 RunSessionFlow，也不新建会话、不启动项目。
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
    expect(sessionsApi.createNativeSession).not.toHaveBeenCalled();
    expect(projectsApi.launchProject).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("已打开会话「会话一」")).toBeInTheDocument();
  });

  it("不支持直接打开的工具不会退化为打开项目或创建会话", async () => {
    projectsApi.listProjects.mockResolvedValue([project()]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-y", "cursor", "Cursor")],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([
      session({ toolId: "install-y", toolName: "Cursor" }),
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开会话" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText(
        "当前工具不支持直接打开历史会话，无法从这里打开。",
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "确认打开" });
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.createNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
    expect(projectsApi.launchProject).not.toHaveBeenCalled();
    expect(screen.getByTestId("pending-project")).toHaveTextContent("");
  });

  it("项目目录不存在时禁用确认且不调用接口", async () => {
    projectsApi.listProjects.mockResolvedValue([project({ pathExists: false })]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-x", "opencode", "OpenCode")],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([
      session({ projectPathExists: false }),
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开会话" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText(
        "项目目录不存在或不可访问，无法打开该会话。",
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "确认打开" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("工具不可用时禁用确认且不打开项目 / 不创建会话", async () => {
    projectsApi.listProjects.mockResolvedValue([project()]);
    toolsApi.listTools.mockResolvedValue({ entries: [], lastDetectionAt: null });
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开会话" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("该会话对应的工具当前不可用，无法打开。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认打开" }),
    ).toBeDisabled();
    expect(screen.getByTestId("pending-project")).toHaveTextContent("");
    expect(sessionsApi.createNativeSession).not.toHaveBeenCalled();
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
  });

  it("项目已移除时禁用确认且不打开项目", async () => {
    projectsApi.listProjects.mockResolvedValue([]);
    sessionsApi.listSessions.mockResolvedValue([
      session({ projectId: "ghost", projectName: "幽灵项目" }),
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "打开会话" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("该会话所属项目已被移除，无法打开。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "确认打开" }),
    ).toBeDisabled();
    expect(screen.getByTestId("pending-project")).toHaveTextContent("");
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("原生打开失败时展示明确错误且保留确认框", async () => {
    availableSetup();
    sessionsApi.restoreNativeSession.mockRejectedValueOnce({
      code: "NATIVE_SESSION_MISSING",
      message: "对应的原生会话已不存在，请刷新历史会话列表。",
    });

    renderPage();

    const dialog = await openSessionDialog();
    fireEvent.click(await confirmButton(dialog));

    expect(
      await within(dialog).findByText(
        "对应的原生会话已不存在，请刷新历史会话列表。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("处理中防止重复确认", async () => {
    availableSetup();
    let resolveRestore: (value: unknown) => void = () => {};
    sessionsApi.restoreNativeSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve;
        }),
    );

    renderPage();

    const dialog = await openSessionDialog();
    const confirm = await confirmButton(dialog);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(sessionsApi.restoreNativeSession).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("button", { name: "处理中…" }),
    ).toBeDisabled();

    resolveRestore({});
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("支持英文标签", async () => {
    availableSetup();

    renderPage(<UseLanguage locale="en-US" />);

    expect(
      await screen.findByRole("heading", { name: "Recent sessions" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Open session" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Session")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });
});

describe("概览：最近项目", () => {
  it("渲染最近项目并提供启动入口", async () => {
    projectsApi.listProjects.mockResolvedValue([
      project({ defaultToolId: "install-x" }),
    ]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-x", "opencode", "OpenCode")],
      lastDetectionAt: null,
    });

    renderPage();

    expect(await screen.findByText("项目 A")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "启动「项目 A」" }),
    ).toBeInTheDocument();
  });

  it("点击启动复用与项目页相同的会话流程", async () => {
    projectsApi.listProjects.mockResolvedValue([
      project({ defaultToolId: "install-x" }),
    ]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-x", "opencode", "OpenCode")],
      lastDetectionAt: null,
    });

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "启动「项目 A」" }),
    );

    await waitFor(() =>
      expect(sessionsApi.syncNativeSessions).toHaveBeenCalledWith(
        "proj-a",
        "install-x",
      ),
    );
  });

  it("打开目录复用既有 openProjectDir 命令", async () => {
    projectsApi.listProjects.mockResolvedValue([project()]);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "更多操作：项目 A" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "打开目录" }));

    await waitFor(() =>
      expect(projectsApi.openProjectDir).toHaveBeenCalledWith("proj-a"),
    );
  });

  it("没有项目时展示空状态", async () => {
    projectsApi.listProjects.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("还没有项目")).toBeInTheDocument();
  });
});

describe("概览：回归", () => {
  it("保留任务与开发工具区块", async () => {
    renderPage();

    expect(await screen.findByText("任务")).toBeInTheDocument();
    expect(screen.getByText("开发工具")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "最近会话" }),
    ).toBeInTheDocument();
  });
});
