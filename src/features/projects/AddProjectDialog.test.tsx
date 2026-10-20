import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AddProjectDialog } from "./AddProjectDialog";
import type { Project } from "../../types/domain";

const createProject = vi.fn();
const importProject = vi.fn();

vi.mock("../../context/ProjectsContext", () => ({
  useProjects: () => ({ createProject, importProject }),
}));

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({ defaultProjectFolder: null }),
}));

vi.mock("../../services/dialog", () => ({ pickDirectory: vi.fn() }));

function project(): Project {
  return {
    id: "proj-new",
    name: "new-project",
    path: "C:\\parent\\new-project",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: null,
    description: null,
    isFavorite: false,
    defaultToolId: null,
    pathExists: true,
  };
}

function renderDialog(onCreated = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider>
      <AddProjectDialog open onClose={onClose} onCreated={onCreated} />
    </I18nProvider>,
  );
  return { onCreated, onClose };
}

function fillCreateForm() {
  fireEvent.change(screen.getByLabelText(/项目名称/), {
    target: { value: "new-project" },
  });
  fireEvent.change(screen.getByLabelText(/所在目录/), {
    target: { value: "C:\\parent" },
  });
}

describe("AddProjectDialog：项目创建", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("创建项目时只提交名称与位置，并回调创建结果", async () => {
    createProject.mockResolvedValue(project());

    const { onCreated, onClose } = renderDialog();
    fillCreateForm();
    expect(
      screen.queryByLabelText("创建项目共享记忆文件"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: "new-project",
        location: "C:\\parent",
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "proj-new" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("导入项目后回调结果并关闭", async () => {
    importProject.mockResolvedValue(project());

    const { onCreated, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "导入已有目录" }));
    fireEvent.change(screen.getByLabelText(/目录路径/), {
      target: { value: "C:\\existing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() =>
      expect(importProject).toHaveBeenCalledWith({
        path: "C:\\existing",
        name: null,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "proj-new" }));
    expect(onClose).toHaveBeenCalled();
  });
});
