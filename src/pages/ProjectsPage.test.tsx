import { useEffect } from "react";
import type { ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../context/AppContext";
import { ProjectsProvider } from "../context/ProjectsContext";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import { WorkspaceProvider } from "../context/WorkspaceContext";
import { I18nProvider } from "../i18n";
import { ProjectsPage } from "./ProjectsPage";
import type { Project, ToolEntry } from "../types/domain";

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
import * as projectToolsService from "../services/projectTools";
import * as tasksService from "../services/tasks";
import * as toolsService from "../services/tools";
import * as sessionsService from "../services/sessions";
import * as settingsService from "../services/settings";
import * as workspaceService from "../services/workspace";

const projectsApi = projectsService as unknown as {
  listProjects: ReturnType<typeof vi.fn>;
  checkProjectHealth: ReturnType<typeof vi.fn>;
  openProjectDir: ReturnType<typeof vi.fn>;
  removeProject: ReturnType<typeof vi.fn>;
};
const projectToolsApi = projectToolsService as unknown as {
  listProjectTools: ReturnType<typeof vi.fn>;
};
const tasksApi = tasksService as unknown as {
  listTasks: ReturnType<typeof vi.fn>;
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
  setSessionStatus: ReturnType<typeof vi.fn>;
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

function OpenOnMount({ id }: { id: string }) {
  const { openProject } = useApp();
  useEffect(() => {
    openProject(id);
    // 仅在挂载时触发一次深链。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
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
                <ProjectsPage />
              </ToolsProvider>
            </ProjectsProvider>
          </WorkspaceProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

async function openDialog() {
  fireEvent.click(
    await screen.findByRole("button", { name: "查看项目详情：项目 A" }),
  );
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  projectsApi.listProjects.mockResolvedValue([project()]);
  projectsApi.checkProjectHealth.mockResolvedValue({
    projectId: "proj-a",
    pathStatus: "ok",
    toolStatus: "notConfigured",
    toolId: null,
  });
  projectsApi.openProjectDir.mockResolvedValue(undefined);
  projectToolsApi.listProjectTools.mockResolvedValue([]);
  tasksApi.listTasks.mockResolvedValue([]);
  toolsApi.listTools.mockResolvedValue({ entries: [], lastDetectionAt: null });
  workspaceApi.listWorkspaceSessions.mockResolvedValue([]);
  settingsApi.getSettings.mockResolvedValue(EMPTY_SETTINGS);
  settingsApi.updateSettings.mockImplementation(async (value: unknown) => value);
  sessionsApi.sessionCapabilities.mockResolvedValue({
    toolId: "install-x",
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
  });
  sessionsApi.syncNativeSessions.mockResolvedValue({
    state: "available",
    sessions: [],
  });
  sessionsApi.listSessions.mockResolvedValue([]);
  sessionsApi.listNativeSessions.mockResolvedValue([]);
  sessionsApi.createNativeSession.mockResolvedValue({});
  sessionsApi.restoreNativeSession.mockResolvedValue({});
  sessionsApi.renameNativeSession.mockResolvedValue(undefined);
  sessionsApi.setSessionStatus.mockResolvedValue(undefined);
  sessionsApi.deleteSessionScoped.mockResolvedValue(undefined);
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("项目详情：居中模态弹窗", () => {
  it("点击项目在窗口内打开模态，列表保持挂载在背后", async () => {
    renderPage();

    const dialog = await openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "项目 A" })).toBeInTheDocument();

    // 底层 Projects 页面未被卸载。
    expect(
      screen.getByPlaceholderText("搜索项目名称或路径…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看项目详情：项目 A" }),
    ).toBeInTheDocument();
  });

  it("关闭弹窗后回到原列表状态（保留搜索条件）", async () => {
    renderPage();

    const search = screen.getByPlaceholderText("搜索项目名称或路径…");
    fireEvent.change(search, { target: { value: "项目" } });

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("搜索项目名称或路径…")).toHaveValue(
      "项目",
    );
    expect(
      screen.getByRole("button", { name: "查看项目详情：项目 A" }),
    ).toBeInTheDocument();
  });

  it("Esc 与遮罩点击关闭弹窗，点击弹窗内部不关闭", async () => {
    renderPage();

    // Esc 关闭。
    let dialog = await openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // 点击弹窗内部不关闭。
    dialog = await openDialog();
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // 点击遮罩（弹窗的父节点）关闭。
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("打开文件夹复用既有 openProjectDir 命令", async () => {
    renderPage();

    const dialog = await openDialog();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "打开文件夹" }),
    );

    await waitFor(() =>
      expect(projectsApi.openProjectDir).toHaveBeenCalledWith("proj-a"),
    );
  });

  it("目录不存在时禁用打开文件夹并给出提示", async () => {
    projectsApi.listProjects.mockResolvedValue([
      project({ pathExists: false }),
    ]);
    projectsApi.checkProjectHealth.mockResolvedValue({
      projectId: "proj-a",
      pathStatus: "missing",
      toolStatus: "notConfigured",
      toolId: null,
    });

    renderPage();

    const dialog = await openDialog();
    expect(
      within(dialog).getByRole("button", { name: "打开文件夹" }),
    ).toBeDisabled();
    expect(within(dialog).getByText("目录不可用")).toBeInTheDocument();
  });

  it("已不存在的项目在弹窗内展示未找到状态", async () => {
    renderPage(<OpenOnMount id="missing" />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("未找到项目")).toBeInTheDocument();
  });

  it("保留会话区块，点击运行进入既有会话流程", async () => {
    projectsApi.listProjects.mockResolvedValue([
      project({ defaultToolId: "install-x" }),
    ]);
    toolsApi.listTools.mockResolvedValue({
      entries: [tool("install-x", "opencode", "OpenCode")],
      lastDetectionAt: null,
    });
    projectToolsApi.listProjectTools.mockResolvedValue([
      {
        id: "pt-x",
        projectId: "proj-a",
        toolId: "install-x",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        sessionCount: 0,
      },
    ]);

    renderPage();

    const dialog = await openDialog();
    expect(within(dialog).getByText("AI 工具与会话")).toBeInTheDocument();

    const run = await within(dialog).findByRole("button", { name: "运行" });

    // 让历史会话读取挂起，验证读取期间的加载动画。
    let resolveSync: (value: { state: "available"; sessions: unknown[] }) => void =
      () => undefined;
    sessionsApi.syncNativeSessions.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    fireEvent.click(run);

    expect(await screen.findByText("正在读取会话…")).toBeInTheDocument();
    await waitFor(() =>
      expect(sessionsApi.syncNativeSessions).toHaveBeenCalledWith(
        "proj-a",
        "install-x",
      ),
    );

    resolveSync({ state: "available", sessions: [] });
    expect(await screen.findByText("还没有历史会话")).toBeInTheDocument();
    expect(screen.queryByText("正在读取会话…")).not.toBeInTheDocument();
  });

  it("支持英文标签", async () => {
    renderPage(<UseLanguage locale="en-US" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "View project details: 项目 A",
      }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByRole("button", { name: "Open folder" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Close" }).length,
    ).toBeGreaterThan(0);
  });
});

/** 从列表的「更多操作」菜单打开移除弹窗，返回弹窗容器。 */
async function openRemoveDialogFromList(title = "移除项目", menuName = "更多操作：项目 A", menuItem = "移除项目") {
  fireEvent.click(await screen.findByRole("button", { name: menuName }));
  fireEvent.click(await screen.findByRole("menuitem", { name: menuItem }));
  const heading = await screen.findByRole("heading", { name: title });
  return heading.closest('[role="dialog"]') as HTMLElement;
}

/** 按可访问名称在弹窗内定位内容。 */
function dialogByHeading(title: string | RegExp): HTMLElement {
  return screen
    .getByRole("heading", { name: title })
    .closest('[role="dialog"]') as HTMLElement;
}

describe("项目移除：范围选择与二次确认", () => {
  it("默认选中「仅从 VibeAcross 移除」，确认后仅移除记录", async () => {
    renderPage();

    const dialog = await openRemoveDialogFromList();
    const radios = within(dialog).getAllByRole("radio");
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

    await waitFor(() =>
      expect(projectsApi.removeProject).toHaveBeenCalledWith("proj-a", false),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "移除项目" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("取消第一次确认不改动任何数据", async () => {
    renderPage();

    const dialog = await openRemoveDialogFromList();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "移除项目" }),
      ).not.toBeInTheDocument(),
    );
    expect(projectsApi.removeProject).not.toHaveBeenCalled();
  });

  it("选择删除磁盘文件夹需经第二次确认，取消则什么都不做", async () => {
    renderPage();

    let dialog = await openRemoveDialogFromList();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /同时删除磁盘文件夹/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

    // 第一次确认后只是切换到二次确认，尚未删除任何内容。
    expect(projectsApi.removeProject).not.toHaveBeenCalled();
    dialog = dialogByHeading("确认删除磁盘文件夹？");
    expect(
      within(dialog).getByText("C:\\proj-a"),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "确认删除磁盘文件夹？" }),
      ).not.toBeInTheDocument(),
    );
    expect(projectsApi.removeProject).not.toHaveBeenCalled();
  });

  it("完成两次确认后以 deleteFolder=true 移除", async () => {
    renderPage();

    let dialog = await openRemoveDialogFromList();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /同时删除磁盘文件夹/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

    dialog = dialogByHeading("确认删除磁盘文件夹？");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "永久删除并移除" }),
    );

    await waitFor(() =>
      expect(projectsApi.removeProject).toHaveBeenCalledWith("proj-a", true),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "确认删除磁盘文件夹？" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("删除失败时保留弹窗与记录并显示错误，可重试成功", async () => {
    projectsApi.removeProject.mockRejectedValueOnce(
      new Error("删除项目目录失败：拒绝访问"),
    );
    renderPage();

    let dialog = await openRemoveDialogFromList();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /同时删除磁盘文件夹/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));
    dialog = dialogByHeading("确认删除磁盘文件夹？");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "永久删除并移除" }),
    );

    expect(
      await screen.findByText("删除项目目录失败：拒绝访问"),
    ).toBeInTheDocument();
    // 弹窗保留、项目记录仍在（列表仍渲染该项目）。
    expect(
      screen.getByRole("heading", { name: "确认删除磁盘文件夹？" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看项目详情：项目 A" }),
    ).toBeInTheDocument();

    // 直接重试成功。
    projectsApi.removeProject.mockResolvedValueOnce(undefined);
    fireEvent.click(
      within(dialogByHeading("确认删除磁盘文件夹？")).getByRole("button", {
        name: "永久删除并移除",
      }),
    );
    await waitFor(() =>
      expect(projectsApi.removeProject).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "确认删除磁盘文件夹？" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("项目详情入口复用同一弹窗且默认一致，成功后关闭详情", async () => {
    renderPage();

    const detail = await openDialog();
    fireEvent.click(within(detail).getByRole("button", { name: "移除项目" }));

    const dialog = dialogByHeading("移除项目");
    const radios = within(dialog).getAllByRole("radio");
    expect(radios[0]).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

    await waitFor(() =>
      expect(projectsApi.removeProject).toHaveBeenCalledWith("proj-a", false),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "项目 A" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("删除范围确认页展示项目名与完整路径", async () => {
    const longPath =
      "C:\\Users\\someone\\projects\\" + "a".repeat(80);
    projectsApi.listProjects.mockResolvedValue([project({ path: longPath })]);
    renderPage();

    let dialog = await openRemoveDialogFromList();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /同时删除磁盘文件夹/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

    dialog = dialogByHeading("确认删除磁盘文件夹？");
    expect(within(dialog).getByText("项目 A")).toBeInTheDocument();
    expect(within(dialog).getByText(longPath)).toHaveAttribute(
      "title",
      longPath,
    );
  });

  it("英文界面展示英文选项、警告与确认按钮", async () => {
    renderPage(<UseLanguage locale="en-US" />);

    const dialog = await openRemoveDialogFromList(
      "Remove project",
      "More actions: 项目 A",
      "Remove project",
    );
    expect(
      within(dialog).getByRole("radio", {
        name: /Remove from VibeAcross only/,
      }),
    ).toBeChecked();

    fireEvent.click(
      within(dialog).getByRole("radio", {
        name: /Also delete the folder on disk/,
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    const confirmDialog = dialogByHeading("Delete the folder on disk?");
    expect(
      within(confirmDialog).getByText(/permanently deleted/),
    ).toBeInTheDocument();
    expect(
      within(confirmDialog).getByRole("button", {
        name: "Delete folder and remove",
      }),
    ).toBeInTheDocument();
  });
});
