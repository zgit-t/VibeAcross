import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../context/AppContext";
import { I18nProvider } from "../../i18n";
import { RevisionProvider } from "../../context/RevisionContext";
import { ProjectsProvider } from "../../context/ProjectsContext";
import { ToolsProvider } from "../../context/ToolsContext";
import { WorkspaceProvider } from "../../context/WorkspaceContext";
import { ProjectDetailDialog } from "./ProjectDetailDialog";
import type { Project } from "../../types/domain";

vi.mock("../../services/projects", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  importProject: vi.fn(),
  renameProject: vi.fn(),
  updateProjectDescription: vi.fn(),
  setProjectFavorite: vi.fn(),
  relocateProject: vi.fn(),
  removeProject: vi.fn(),
  touchProjectOpened: vi.fn(),
  setProjectTool: vi.fn(),
  launchProject: vi.fn(),
  openProjectDir: vi.fn(),
  checkProjectHealth: vi.fn(),
}));

vi.mock("../../services/tools", () => ({
  listTools: vi.fn(),
  detectTools: vi.fn(),
  revalidateTool: vi.fn(),
  addTool: vi.fn(),
  updateTool: vi.fn(),
  removeTool: vi.fn(),
  setDefaultTool: vi.fn(),
  resolveToolCommand: vi.fn(),
}));

vi.mock("../../services/projectTools", () => ({
  listProjectTools: vi.fn(),
  addProjectTool: vi.fn(),
  removeProjectTool: vi.fn(),
  listProjectsForTool: vi.fn(),
}));

vi.mock("../../services/tasks", () => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskStatus: vi.fn(),
  deleteTask: vi.fn(),
  taskStats: vi.fn(),
}));

vi.mock("../../services/workspace", () => ({
  listWorkspaceSessions: vi.fn(),
  lastWorkspaceSession: vi.fn(),
  createWorkspaceSession: vi.fn(),
  updateWorkspaceSession: vi.fn(),
  deleteWorkspaceSession: vi.fn(),
  restoreWorkspaceSession: vi.fn(),
}));

vi.mock("../../services/dialog", () => ({
  pickDirectory: vi.fn(),
}));

vi.mock("../../services/clipboard", () => ({
  copyText: vi.fn(),
}));

import * as projectsApi from "../../services/projects";
import * as toolsApi from "../../services/tools";
import * as projectToolsApi from "../../services/projectTools";
import * as tasksApi from "../../services/tasks";
import * as workspaceApi from "../../services/workspace";
import * as dialogApi from "../../services/dialog";
import * as clipboardApi from "../../services/clipboard";

const projects = projectsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tools = toolsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const projectTools = projectToolsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tasks = tasksApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const workspace = workspaceApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const dialog = dialogApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const clipboard = clipboardApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const PROJECT: Project = {
  id: "proj-1",
  name: "示例项目",
  path: "C:\\projects\\demo",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastOpenedAt: null,
  description: "备注内容",
  isFavorite: false,
  defaultToolId: null,
  pathExists: true,
};

function renderDialog(onClose: () => void = () => undefined) {
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <ProjectsProvider>
            <ToolsProvider>
              <WorkspaceProvider>
                <ProjectDetailDialog projectId={PROJECT.id} onClose={onClose} />
              </WorkspaceProvider>
            </ToolsProvider>
          </ProjectsProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};

  projects.listProjects.mockResolvedValue([PROJECT]);
  projects.checkProjectHealth.mockResolvedValue({
    projectId: PROJECT.id,
    pathStatus: "ok",
    toolStatus: "notConfigured",
    toolId: null,
  });
  tools.listTools.mockResolvedValue({ entries: [], lastDetectionAt: null });
  projectTools.listProjectTools.mockResolvedValue([]);
  tasks.listTasks.mockResolvedValue([]);
  workspace.listWorkspaceSessions.mockResolvedValue([]);
  workspace.lastWorkspaceSession.mockResolvedValue(null);
  dialog.pickDirectory.mockResolvedValue(null);
  clipboard.copyText.mockResolvedValue(true);
});

/** 弹窗头部关闭图标与底部「关闭」按钮同名，取底部那个用于关闭。 */
function closeDialogButton(): HTMLElement {
  const buttons = screen.getAllByRole("button", { name: "关闭" });
  return buttons[buttons.length - 1];
}

describe("项目详情弹窗", () => {
  it("保留项目编辑、健康检查、会话与任务区块，且不再展示共享上下文", async () => {
    renderDialog();

    expect(await screen.findByDisplayValue("示例项目")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开文件夹" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("项目备注")).toHaveValue("备注内容");
    expect(screen.getByText("AI 工具与会话")).toBeInTheDocument();
    expect(screen.getByText("任务")).toBeInTheDocument();
    expect(screen.queryByText("共享上下文")).not.toBeInTheDocument();
    expect(screen.queryByText("项目记忆采集")).not.toBeInTheDocument();
  });

  it("点击关闭直接回调，不再有共享上下文未保存拦截", async () => {
    const onClose = vi.fn();
    renderDialog(onClose);

    await screen.findByDisplayValue("示例项目");
    fireEvent.click(closeDialogButton());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("有未保存的更改")).not.toBeInTheDocument();
  });
});
