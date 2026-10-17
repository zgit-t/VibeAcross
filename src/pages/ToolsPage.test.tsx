import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../context/AppContext";
import { I18nProvider } from "../i18n";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import { formatDateTime } from "../utils/format";
import type { ToolEntry } from "../types/domain";
import { ToolsPage } from "./ToolsPage";

vi.mock("../services/tools", () => ({
  listTools: vi.fn(),
  detectTools: vi.fn(),
  revalidateTool: vi.fn(),
  addTool: vi.fn(),
  updateTool: vi.fn(),
  removeTool: vi.fn(),
  setDefaultTool: vi.fn(),
}));

import * as toolsApi from "../services/tools";

const toolsMock = toolsApi as unknown as {
  listTools: ReturnType<typeof vi.fn>;
};

const LONG_PATH = "D:\\Tools\\Very Long Folder Name\\Trae CN\\Trae CN.exe";
const DETECTED_AT = "2026-01-02T03:04:05Z";

function makeTool(overrides: Partial<ToolEntry> & Pick<ToolEntry, "id">): ToolEntry {
  return {
    toolId: "trae",
    name: "Trae CN",
    vendor: "ByteDance",
    description: "AI IDE",
    toolType: "cli",
    source: "auto",
    status: "detected",
    executablePath: LONG_PATH,
    commandName: null,
    version: "1.2.3",
    detectionMethod: "自动扫描",
    isCustom: false,
    isDefault: false,
    detectedAt: DETECTED_AT,
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

function renderPage(tools: ToolEntry[]) {
  toolsMock.listTools.mockResolvedValue({
    entries: tools,
    lastDetectionAt: null,
  });
  return render(
    <AppProvider>
      <I18nProvider>
        <RevisionProvider>
          <ToolsProvider>
            <ToolsPage />
          </ToolsProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe("ToolsPage 工具列表布局", () => {
  it("名称、来源标签与类型标签位于名称行同一容器内，且不含操作按钮", async () => {
    renderPage([makeTool({ id: "t1" })]);

    const name = await screen.findByText("Trae CN");
    const titleRow = name.parentElement as HTMLElement;
    expect(within(titleRow).getByText("自动检测")).toBeInTheDocument();
    expect(within(titleRow).getByText("命令行工具")).toBeInTheDocument();
    // 操作按钮属于右侧操作区，绝不能进入名称行。
    expect(within(titleRow).queryByRole("button")).toBeNull();
  });

  it("默认标识与手动配置标签随名称同行显示", async () => {
    renderPage([
      makeTool({
        id: "t1",
        name: "OpenAI Codex CLI",
        source: "manual",
        toolType: "desktop",
        isDefault: true,
        status: "pathMissing",
        executablePath: null,
        commandName: "codex",
      }),
    ]);

    const name = await screen.findByText("OpenAI Codex CLI");
    const titleRow = name.parentElement as HTMLElement;
    expect(within(titleRow).getByText("默认")).toBeInTheDocument();
    expect(within(titleRow).getByText("手动配置")).toBeInTheDocument();
    expect(within(titleRow).getByText("桌面应用")).toBeInTheDocument();
  });

  it("卡片分为左右两个同级区域：左侧信息区无按钮，右侧操作区按钮齐全", async () => {
    renderPage([makeTool({ id: "t1" })]);

    const name = await screen.findByText("Trae CN");
    const row = name.closest("li") as HTMLElement;
    // 卡片行只有两个直接子区域：左信息区 + 右操作区。
    expect(row.children.length).toBe(2);
    const [info, actions] = Array.from(row.children) as HTMLElement[];
    expect(info.contains(name)).toBe(true);
    // 操作按钮只存在于右侧操作区，不散落在信息区。
    expect(within(info).queryByRole("button")).toBeNull();
    expect(within(actions).getByRole("button", { name: "配置" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "移除" })).toBeInTheDocument();
    // 「能力与历史来源」入口已移除，不再出现在操作区。
    expect(
      within(actions).queryByRole("button", { name: "能力与历史来源" }),
    ).toBeNull();
  });

  it("被截断的路径提供完整路径悬停提示与可选中查看", async () => {
    renderPage([makeTool({ id: "t1" })]);

    const path = await screen.findByText(LONG_PATH);
    expect(path).toHaveAttribute("title", LONG_PATH);
    expect(path).toHaveAttribute("data-selectable", "true");
  });

  it("底部只显示供应商与检测时间，不再出现检测方式等长文本", async () => {
    renderPage([makeTool({ id: "t1" })]);

    const meta = await screen.findByText(/ByteDance/);
    const text = meta.textContent ?? "";
    const title = meta.getAttribute("title") ?? "";
    expect(text).toContain("ByteDance");
    expect(text).toContain(formatDateTime(DETECTED_AT));
    // 检测方式 / 版本等技术细节不再出现在卡片底部。
    expect(title).not.toContain("自动扫描");
    expect(title).not.toContain("1.2.3");
    // 供应商位于信息区元信息行，而非名称行。
    const name = screen.getByText("Trae CN");
    expect(
      within(name.parentElement as HTMLElement).queryByText("ByteDance"),
    ).toBeNull();
  });

  it("没有检测时间时只显示供应商，不伪造检测时间", async () => {
    renderPage([makeTool({ id: "t1", detectedAt: null })]);

    const meta = await screen.findByText("ByteDance");
    expect(meta.textContent).toBe("ByteDance");
    expect(screen.queryByText(/检测于/)).toBeNull();
  });

  it("没有供应商时只显示检测时间", async () => {
    renderPage([makeTool({ id: "t1", vendor: "" })]);

    const meta = await screen.findByText(/检测于/);
    expect(meta.textContent).toContain(formatDateTime(DETECTED_AT));
  });

  it("不同名称与状态组合下，每行的名称行都保持完整标签集合", async () => {
    renderPage([
      makeTool({ id: "t1", name: "Trae", toolType: "cli", source: "auto" }),
      makeTool({
        id: "t2",
        name: "OpenAI Codex CLI",
        toolType: "desktop",
        source: "manual",
        status: "pathMissing",
        executablePath: null,
        commandName: "codex",
        detectedAt: null,
        version: null,
      }),
    ]);

    const shortTool = await screen.findByText("Trae");
    const shortRow = shortTool.parentElement as HTMLElement;
    expect(within(shortRow).getByText("命令行工具")).toBeInTheDocument();

    const longTool = await screen.findByText("OpenAI Codex CLI");
    const longRow = longTool.parentElement as HTMLElement;
    expect(within(longRow).getByText("桌面应用")).toBeInTheDocument();
    expect(within(longRow).getByText("手动配置")).toBeInTheDocument();
  });
});
