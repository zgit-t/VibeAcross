import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../context/AppContext";
import { ProjectsProvider } from "../context/ProjectsContext";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import { WorkspaceProvider } from "../context/WorkspaceContext";
import { I18nProvider } from "../i18n";
import { setLocale } from "../i18n/locale";
import { SessionsPage } from "./SessionsPage";
import type {
  AiSession,
  NativeSupport,
  Project,
  SessionDeleteOutcome,
  ToolEntry,
} from "../types/domain";

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
import * as toolsService from "../services/tools";
import * as tasksService from "../services/tasks";
import * as sessionsService from "../services/sessions";
import * as settingsService from "../services/settings";
import * as workspaceService from "../services/workspace";

const projectsApi = projectsService as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
  launchProject: ReturnType<typeof vi.fn>;
};
const toolsApi = toolsService as unknown as {
  listTools: ReturnType<typeof vi.fn>;
};
const tasksApi = tasksService as unknown as {
  listTasks: ReturnType<typeof vi.fn>;
  taskStats: ReturnType<typeof vi.fn>;
};const sessionsApi = sessionsService as unknown as {
  sessionCapabilities: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  syncNativeSessions: ReturnType<typeof vi.fn>;
  restoreNativeSession: ReturnType<typeof vi.fn>;
  renameNativeSession: ReturnType<typeof vi.fn>;
  deleteSessionScoped: ReturnType<typeof vi.fn>;
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

function tool(
  id: string,
  toolId: string,
  name: string,
  launchSupport: "supported" | "unavailable" = "supported",
): ToolEntry {
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
    launch: { support: launchSupport, method: "workingDirectory", reason: "" },
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

function makeCaps(
  toolId: string,
  restore: NativeSupport,
  list: NativeSupport = "supported",
) {
  return {
    toolId,
    create: "supported" as const,
    list,
    restore,
    nativeId: "supported" as const,
    renameTitle: "unsupported" as const,
    delete: "supported" as const,
    history: {
      kind: "service" as const,
      completeness: "fullNative" as const,
      stableNativeId: true,
      readsMessages: false,
      canRestore: true,
      summary: "",
      limitations: "",
    },
    notes: "",
  };
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

function renderPage(extra?: ReactNode) {
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <WorkspaceProvider>
            <ProjectsProvider>
              <ToolsProvider>
                {extra}
                <SessionsPage />
              </ToolsProvider>
            </ProjectsProvider>
          </WorkspaceProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

function rows() {
  return screen.getAllByRole("listitem");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setLocale("zh-CN");
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  projectsApi.listProjects.mockResolvedValue([project()]);
  projectsApi.launchProject.mockResolvedValue({ toolName: "OpenCode" });
  toolsApi.listTools.mockResolvedValue({
    entries: [tool("install-x", "opencode", "OpenCode")],
    lastDetectionAt: null,
  });
  tasksApi.listTasks.mockResolvedValue([]);
  tasksApi.taskStats.mockResolvedValue({
    todo: 0,
    inProgress: 0,
    done: 0,
    total: 0,
  });
  workspaceApi.listWorkspaceSessions.mockResolvedValue([]);
  settingsApi.getSettings.mockResolvedValue(EMPTY_SETTINGS);
  settingsApi.updateSettings.mockImplementation(async (value: unknown) => value);
  sessionsApi.listSessions.mockResolvedValue([]);
  sessionsApi.syncNativeSessions.mockResolvedValue({
    state: "available",
    sessions: [],
    skipped: 0,
  });
  sessionsApi.sessionCapabilities.mockImplementation(
    async (toolId: string) =>
      makeCaps(toolId, toolId === "opencode" ? "supported" : "unsupported"),
  );
  sessionsApi.restoreNativeSession.mockResolvedValue({});
  sessionsApi.renameNativeSession.mockImplementation(
    async (id: string, name: string) => ({
      session: session({ id, displayName: name }),
    }),
  );
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("会话中心", () => {
  it("列出全部会话，展示归属项目与工具及总数量", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    expect(await screen.findByText("会话一")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("OpenCode")).toBeInTheDocument();
    expect(within(list).getByText("项目 A")).toBeInTheDocument();
    expect(screen.getByText("共 1 条会话")).toBeInTheDocument();
  });

  it("默认按最近活动时间倒序排列", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "old",
        displayName: "旧会话",
        nativeSessionId: "n-old",
        lastUsedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }),
      session({
        id: "new",
        displayName: "新会话",
        nativeSessionId: "n-new",
        lastUsedAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      }),
    ]);

    renderPage();

    await screen.findByText("新会话");
    const items = rows();
    expect(items[0]).toHaveTextContent("新会话");
    expect(items[1]).toHaveTextContent("旧会话");
  });

  it("按会话名称即时搜索过滤", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({ id: "a", displayName: "登录功能开发" }),
      session({
        id: "b",
        displayName: "支付重构",
        nativeSessionId: "native-2",
      }),
    ]);

    renderPage();

    await screen.findByText("登录功能开发");
    fireEvent.change(screen.getByLabelText("搜索会话"), {
      target: { value: "支付" },
    });

    expect(screen.getByText("支付重构")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();
  });

  it("搜索无结果时展示空状态，并可清除筛选", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    await screen.findByText("会话一");
    fireEvent.change(screen.getByLabelText("搜索会话"), {
      target: { value: "不存在" },
    });

    expect(await screen.findByText("没有匹配的会话")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "清除筛选" })[0],
    );
    expect(await screen.findByText("会话一")).toBeInTheDocument();
  });

  it("按项目与工具筛选会话", async () => {
    projectsApi.listProjects.mockResolvedValue([
      project(),
      project({ id: "proj-b", name: "项目 B", path: "C:\\proj-b" }),
    ]);
    toolsApi.listTools.mockResolvedValue({
      entries: [
        tool("install-x", "opencode", "OpenCode"),
        tool("install-y", "cursor", "Cursor"),
      ],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([
      session({ id: "a", displayName: "会话一" }),
      session({
        id: "b",
        displayName: "会话二",
        nativeSessionId: "native-2",
        projectId: "proj-b",
        projectName: "项目 B",
        toolId: "install-y",
        toolName: "Cursor",
      }),
    ]);

    renderPage();

    await screen.findByText("会话一");
    fireEvent.change(screen.getByLabelText("按项目筛选"), {
      target: { value: "proj-b" },
    });
    expect(screen.getByText("会话二")).toBeInTheDocument();
    expect(screen.queryByText("会话一")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("按项目筛选"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("按工具筛选"), {
      target: { value: "install-x" },
    });
    expect(screen.getByText("会话一")).toBeInTheDocument();
    expect(screen.queryByText("会话二")).not.toBeInTheDocument();
  });

  it("可切换为按名称排序", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({ id: "b", displayName: "B 会话", nativeSessionId: "n-b" }),
      session({ id: "a", displayName: "A 会话", nativeSessionId: "n-a" }),
    ]);

    renderPage();

    await screen.findByText("A 会话");
    fireEvent.click(screen.getByRole("button", { name: "名称" }));

    const items = rows();
    expect(items[0]).toHaveTextContent("A 会话");
    expect(items[1]).toHaveTextContent("B 会话");
  });

  it("合并同一工具下重复的原生会话记录", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "older",
        displayName: "重复旧记录",
        nativeSessionId: "dup",
        lastUsedAt: "2026-01-01T00:00:00Z",
      }),
      session({
        id: "newer",
        displayName: "重复新记录",
        nativeSessionId: "dup",
        lastUsedAt: "2026-06-01T00:00:00Z",
      }),
    ]);

    renderPage();

    await screen.findByText("重复新记录");
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText("重复旧记录")).not.toBeInTheDocument();
  });

  it("打开会话调用原生恢复接口并传入该会话 id", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "继续会话" }));

    await waitFor(() =>
      expect(sessionsApi.restoreNativeSession).toHaveBeenCalledWith("session-1"),
    );
    expect(await screen.findByText("已打开会话「会话一」")).toBeInTheDocument();
    expect(projectsApi.launchProject).not.toHaveBeenCalled();
  });

  it("工具不支持恢复时提供「打开项目」，且绝不冒充恢复会话", async () => {
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-y", "cursor", "Cursor")],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "s-cursor",
        toolId: "install-y",
        toolName: "Cursor",
        displayName: "Cursor 会话",
      }),
    ]);

    renderPage();

    await screen.findByText("Cursor 会话");
    expect(
      screen.queryByRole("button", { name: "继续会话" }),
    ).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "打开项目" }));

    await waitFor(() =>
      expect(projectsApi.launchProject).toHaveBeenCalledWith(
        "proj-a",
        "install-y",
      ),
    );
    expect(sessionsApi.restoreNativeSession).not.toHaveBeenCalled();
  });

  it("工具既不支持恢复也不支持打开时不提供任何打开入口", async () => {
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-y", "cursor", "Cursor", "unavailable")],
      lastDetectionAt: null,
    });
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "s-cursor",
        toolId: "install-y",
        toolName: "Cursor",
        displayName: "Cursor 会话",
      }),
    ]);

    renderPage();

    await screen.findByText("Cursor 会话");
    expect(
      screen.queryByRole("button", { name: "继续会话" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开项目" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("当前工具不支持直接打开历史会话，无法从这里打开。"),
    ).toBeInTheDocument();
  });

  it("重命名调用接口并即时更新显示名称", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "重命名" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("会话名称"), {
      target: { value: "新的名称" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(sessionsApi.renameNativeSession).toHaveBeenCalledWith(
        "session-1",
        "新的名称",
        false,
      ),
    );
    expect(await screen.findByText("新的名称")).toBeInTheDocument();
  });

  it("刷新按钮重新读取会话列表", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();

    await screen.findByText("会话一");
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("刷新会同步已知且支持枚举的项目 × 工具的原生会话", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();
    // 「继续会话」只有在能力矩阵加载完成后才出现，可据此确保同步判定已就绪。
    await screen.findByRole("button", { name: "继续会话" });
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() =>
      expect(sessionsApi.syncNativeSessions).toHaveBeenCalledWith(
        "proj-a",
        "install-x",
      ),
    );
    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("工具不支持枚举时不触发原生同步，但仍重读列表", async () => {
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-y", "cursor", "Cursor")],
      lastDetectionAt: null,
    });
    sessionsApi.sessionCapabilities.mockResolvedValue(
      makeCaps("cursor", "unsupported", "unsupported"),
    );
    sessionsApi.listSessions.mockResolvedValue([
      session({
        id: "s-cursor",
        toolId: "install-y",
        toolName: "Cursor",
        displayName: "Cursor 会话",
      }),
    ]);

    renderPage();
    await screen.findByRole("button", { name: "打开项目" });
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
    expect(sessionsApi.syncNativeSessions).not.toHaveBeenCalled();
  });

  it("原生同步部分失败时给出警告并仍重读列表", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    sessionsApi.syncNativeSessions.mockRejectedValue({
      code: "NATIVE_LIST_UNSUPPORTED",
      message: "原生会话枚举失败。",
    });

    renderPage();
    await screen.findByRole("button", { name: "继续会话" });
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText(/原生会话同步失败/)).toBeInTheDocument();
    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("没有最近使用时间时按更新时间展示，避免误标为最近使用", async () => {
    sessionsApi.listSessions.mockResolvedValue([
      session({ lastUsedAt: null, updatedAt: "2026-01-02T00:00:00Z" }),
    ]);

    renderPage();
    await screen.findByText("会话一");

    expect(screen.getByText(/更新于/)).toBeInTheDocument();
    expect(screen.queryByText(/最近使用/)).not.toBeInTheDocument();
  });

  it("读取失败时展示错误并可重试", async () => {
    sessionsApi.listSessions
      .mockRejectedValueOnce(undefined)
      .mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("读取会话列表失败。")).toBeInTheDocument();
    const before = sessionsApi.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(sessionsApi.listSessions.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("没有会话时展示空状态", async () => {
    sessionsApi.listSessions.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("还没有会话记录")).toBeInTheDocument();
  });

  it("本地删除只提交 local 范围，成功后刷新列表", async () => {
    sessionsApi.listSessions
      .mockResolvedValueOnce([session()])
      .mockResolvedValue([]);
    sessionsApi.deleteSessionScoped.mockResolvedValue(deleteOutcome());

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("radio", {
        name: /仅删除 VibeAcross 中的记录/,
      }),
    ).toBeChecked();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "删除本地记录" }),
    );

    await waitFor(() =>
      expect(sessionsApi.deleteSessionScoped).toHaveBeenCalledWith(
        "session-1",
        "local",
      ),
    );
    expect(
      await screen.findByText(/已删除会话「会话一」的本地记录/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryAllByRole("listitem")).toHaveLength(0),
    );
  });

  it("原生删除必须二次确认，成功后保留并标记本地记录", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    sessionsApi.deleteSessionScoped.mockResolvedValue(
      deleteOutcome({
        scope: "native",
        nativeDeleted: true,
        localDeleted: false,
      }),
    );

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", {
        name: /仅删除 AI 工具中的会话/,
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "继续" }));

    // 二次确认前绝不调用删除接口。
    expect(sessionsApi.deleteSessionScoped).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText("OpenCode")).toBeInTheDocument();
    expect(within(confirm).getByText("项目 A")).toBeInTheDocument();
    expect(within(confirm).getByText("会话一")).toBeInTheDocument();
    expect(
      within(confirm).getByText("仅删除 AI 工具中的会话"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(sessionsApi.deleteSessionScoped).toHaveBeenCalledWith(
        "session-1",
        "native",
      ),
    );
    expect(
      await screen.findByText(/已删除工具中的原生会话/),
    ).toBeInTheDocument();
    expect(screen.getByText("原生会话已删除")).toBeInTheDocument();
    expect(screen.getByText("会话一")).toBeInTheDocument();
  });

  it("取消二次确认不会删除会话", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", {
        name: /仅删除 AI 工具中的会话/,
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "继续" }));

    const confirm = await screen.findByRole("dialog", {
      name: "确认删除原生会话",
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));

    expect(sessionsApi.deleteSessionScoped).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "确认删除原生会话" }),
    ).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it("工具不支持原生删除时禁用原生与两者选项", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    sessionsApi.sessionCapabilities.mockResolvedValue({
      ...makeCaps("opencode", "supported"),
      delete: "unsupported" as const,
    });

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("radio", {
        name: /仅删除 AI 工具中的会话/,
      }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("radio", { name: /同时删除两者/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("OpenCode 暂不支持删除原生会话。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "删除本地记录" }),
    ).toBeEnabled();
  });

  it("部分成功时保留记录、标记原生已删除并提示可重试", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    sessionsApi.deleteSessionScoped.mockResolvedValue(
      deleteOutcome({
        scope: "both",
        nativeDeleted: true,
        localDeleted: false,
        localCleanupFailed: true,
        localCleanupError: "数据库被锁定",
      }),
    );

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /同时删除两者/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "继续" }));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "确认删除" }),
    );

    expect(
      await screen.findByText(/本地记录清理失败：数据库被锁定/),
    ).toBeInTheDocument();
    expect(screen.getByText("原生会话已删除")).toBeInTheDocument();
    expect(screen.getByText("会话一")).toBeInTheDocument();
  });

  it("删除失败时保留记录并展示真实错误", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    sessionsApi.deleteSessionScoped.mockRejectedValue({
      code: "DB_ERROR",
      message: "数据库写入失败",
    });

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "删除本地记录" }),
    );

    expect(await screen.findByText("数据库写入失败")).toBeInTheDocument();
    expect(screen.getAllByText("会话一").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/已删除会话「会话一」的本地记录/),
    ).not.toBeInTheDocument();
  });

  it("删除执行期间禁止重复提交", async () => {
    sessionsApi.listSessions.mockResolvedValue([session()]);
    let resolveDelete!: (value: SessionDeleteOutcome) => void;
    sessionsApi.deleteSessionScoped.mockReturnValue(
      new Promise<SessionDeleteOutcome>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    renderPage();
    await screen.findByText("会话一");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = await screen.findByRole("dialog");
    const deleteButton = within(dialog).getByRole("button", {
      name: "删除本地记录",
    });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(sessionsApi.deleteSessionScoped).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("button", { name: "处理中…" }),
    ).toBeDisabled();

    resolveDelete(deleteOutcome());
    await waitFor(() =>
      expect(sessionsApi.deleteSessionScoped).toHaveBeenCalledTimes(1),
    );
  });
});
