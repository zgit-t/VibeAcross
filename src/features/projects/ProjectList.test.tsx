import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../context/AppContext";
import { I18nProvider } from "../../i18n";
import { ProjectList } from "./ProjectList";
import type { Project, ToolEntry } from "../../types/domain";

function toolEntry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    id: "install-1",
    toolId: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    description: "",
    toolType: "desktop",
    source: "auto",
    status: "detected",
    executablePath: "C:\\cursor\\Cursor.exe",
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
    launch: { support: "supported", method: "folderArgument", reason: "" },
    restore: {
      level: "project",
      levelReason: "",
      session: "unsupported",
      sessionReason: "",
    },
    installed: true,
    ...overrides,
  };
}

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

function renderList(props: Parameters<typeof ProjectList>[0]) {
  return render(
    <AppProvider>
      <I18nProvider>
        <ProjectList {...props} />
      </I18nProvider>
    </AppProvider>,
  );
}

describe("项目列表：当前工具状态展示", () => {
  it("未设置默认工具时不显示异常标签，并允许选择与运行", () => {
    const opencode = toolEntry({ id: "install-1", toolId: "opencode", name: "OpenCode" });
    const onRun = vi.fn();

    renderList({
      projects: [project({ defaultToolId: null })],
      showLaunch: true,
      tools: [opencode],
      onRun,
      onSetTool: () => undefined,
    });

    expect(screen.queryByText("（默认工具不可用）")).not.toBeInTheDocument();
    expect(screen.queryByText("（尚未检测到）")).not.toBeInTheDocument();

    const select = screen.getByLabelText("为「项目 A」选择当前工具");
    expect(select).toBeEnabled();

    const runButton = screen.getByRole("button", {
      name: "请先选择一个可用的开发工具",
    });
    expect(runButton).toBeEnabled();

    fireEvent.click(runButton);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("已设置但尚未检测到时显示准确状态，而非「不可用」", () => {
    const notDetected = toolEntry({
      id: "install-old",
      toolId: "cursor",
      name: "Cursor",
      status: "notDetected",
      installed: false,
      launch: { support: "unavailable", method: null, reason: "尚未检测到" },
    });

    renderList({
      projects: [project({ defaultToolId: "install-old" })],
      showLaunch: true,
      tools: [notDetected],
      onRun: () => undefined,
      onSetTool: () => undefined,
    });

    expect(screen.getByText("（尚未检测到）")).toBeInTheDocument();
    expect(screen.queryByText("（默认工具不可用）")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "当前工具尚未检测到，请先检测或重新选择",
      }),
    ).toBeDisabled();
  });

  it("已检测到但无法受控启动时显示「当前无法启动」", () => {
    const blocked = toolEntry({
      id: "install-b",
      name: "Blocked",
      launch: { support: "unsupported", method: null, reason: "自定义桌面应用参数未知" },
    });

    renderList({
      projects: [project({ defaultToolId: "install-b" })],
      showLaunch: true,
      tools: [blocked],
      onRun: () => undefined,
      onSetTool: () => undefined,
    });

    expect(screen.getByText("（当前无法启动）")).toBeInTheDocument();
    expect(screen.queryByText("（默认工具不可用）")).not.toBeInTheDocument();
  });

  it("已设置且可启动时无异常标签，运行按钮可用", () => {
    const cursor = toolEntry({ id: "install-1", name: "Cursor" });

    renderList({
      projects: [project({ defaultToolId: "install-1" })],
      showLaunch: true,
      tools: [cursor],
      onRun: () => undefined,
      onSetTool: () => undefined,
    });

    expect(screen.queryByText(/尚未检测到|当前无法启动|工具已移除|默认工具不可用/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动「项目 A」" })).toBeEnabled();
  });
});
