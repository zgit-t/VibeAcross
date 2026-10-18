import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../context/AppContext";
import { I18nProvider } from "../i18n";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import { formatDateTime } from "../utils/format";
import type { ToolEntry } from "../types/domain";
import { ToolsPage } from "./ToolsPage";
import { TutorialsPage } from "./TutorialsPage";

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
  detectTools: ReturnType<typeof vi.fn>;
  revalidateTool: ReturnType<typeof vi.fn>;
  addTool: ReturnType<typeof vi.fn>;
  updateTool: ReturnType<typeof vi.fn>;
  removeTool: ReturnType<typeof vi.fn>;
  setDefaultTool: ReturnType<typeof vi.fn>;
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
  window.localStorage.clear();
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

function renderPageWithTutorials(tools: ToolEntry[]) {
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
            <TutorialsPage />
          </ToolsProvider>
        </RevisionProvider>
      </I18nProvider>
    </AppProvider>,
  );
}

describe("ToolsPage 教程入口", () => {
  it("每个工具卡片的操作区都提供教程按钮", async () => {
    renderPage([
      makeTool({ id: "t1" }),
      makeTool({ id: "t2", toolId: "custom", name: "自定义工具", isCustom: true }),
    ]);

    const detected = await screen.findByText("Trae CN");
    const detectedActions = (detected.closest("li") as HTMLElement)
      .children[1] as HTMLElement;
    expect(
      within(detectedActions).getByRole("button", { name: "教程" }),
    ).toBeInTheDocument();

    const custom = screen.getByText("自定义工具");
    const customActions = (custom.closest("li") as HTMLElement)
      .children[1] as HTMLElement;
    expect(
      within(customActions).getByRole("button", { name: "教程" }),
    ).toBeInTheDocument();
  });

  it("点击卡片教程入口打开该工具在教程中心的教程", async () => {
    renderPageWithTutorials([
      makeTool({ id: "t1", toolId: "cursor", name: "Cursor" }),
    ]);

    const card = await waitFor(() => {
      const found = screen
        .getAllByRole("listitem")
        .find(
          (item) =>
            within(item).queryByText("Cursor") !== null &&
            within(item).queryByRole("button", { name: "教程" }) !== null,
        );
      if (!found) {
        throw new Error("工具卡片尚未渲染完成");
      }
      return found;
    });
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: "教程" }),
    );

    const detail = await screen.findByRole("article", { name: "Cursor" });
    expect(detail).toBeInTheDocument();
    // 默认教程（Trae）让位给被点击工具的教程。
    expect(
      screen.queryByRole("article", { name: "Trae" }),
    ).not.toBeInTheDocument();
  });
});

/** 未检测工具：内置占位（`builtin`）只有 教程 / 手动配置 / 检测 三个操作。 */
function makeBuiltinTool(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return makeTool({
    id: "b1",
    name: "Trae",
    source: "builtin",
    status: "notInstalled",
    installed: false,
    executablePath: null,
    commandName: null,
    detectedAt: null,
    version: null,
    ...overrides,
  });
}

function emptyState() {
  return { entries: [] as ToolEntry[], lastDetectionAt: null };
}

async function findRow(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const node = screen.getByText(name);
    const row = node.closest("li");
    if (!row) {
      throw new Error(`未找到「${name}」所在卡片`);
    }
    return row as HTMLElement;
  });
}

function actionAreaOf(row: HTMLElement): HTMLElement {
  return row.children[1] as HTMLElement;
}

function buttonLabels(actions: HTMLElement): string[] {
  return within(actions)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("ToolsPage 操作区布局", () => {
  it("已检测工具的操作区包含 5 个按钮，且顺序与文案固定", async () => {
    renderPage([makeTool({ id: "d1" })]);
    const row = await findRow("Trae CN");
    const actions = actionAreaOf(row);

    expect(buttonLabels(actions)).toEqual([
      "教程",
      "设为默认",
      "配置",
      "重新检测",
      "移除",
    ]);
  });

  it("未检测工具的操作区包含 3 个按钮，且顺序与文案固定", async () => {
    renderPage([makeBuiltinTool()]);
    const row = await findRow("Trae");
    const actions = actionAreaOf(row);

    expect(buttonLabels(actions)).toEqual(["教程", "手动配置", "检测"]);
  });

  it("已检测与未检测工具共用一致的卡片分区结构", async () => {
    renderPage([makeTool({ id: "d1" }), makeBuiltinTool()]);

    const detectedRow = await findRow("Trae CN");
    const builtinRow = await findRow("Trae");

    // 两种状态都严格是「左信息区 + 右操作区」两个同级区域。
    expect(detectedRow.children.length).toBe(2);
    expect(builtinRow.children.length).toBe(2);
    const [detectedInfo, detectedActions] = Array.from(
      detectedRow.children,
    ) as HTMLElement[];
    const [builtinInfo, builtinActions] = Array.from(
      builtinRow.children,
    ) as HTMLElement[];

    // 分区结构与样式类在两状态间完全一致，不因按钮数量改变。
    expect(detectedInfo.className).toBe(builtinInfo.className);
    expect(detectedActions.className).toBe(builtinActions.className);

    // 信息区不含任何按钮，所有操作按钮只出现在操作区。
    expect(within(detectedInfo).queryByRole("button")).toBeNull();
    expect(within(builtinInfo).queryByRole("button")).toBeNull();
    expect(within(detectedActions).getAllByRole("button").length).toBe(5);
    expect(within(builtinActions).getAllByRole("button").length).toBe(3);
  });

  it("英文标签更长时仍渲染固定的 5 个按钮（换行由布局规则控制）", async () => {
    window.localStorage.setItem("vibeacross.language", "en-US");
    renderPage([makeTool({ id: "d1" })]);
    const row = await findRow("Trae CN");
    const actions = actionAreaOf(row);

    const labels = buttonLabels(actions);
    expect(labels).toEqual([
      "Guide",
      "Set as default",
      "Configure",
      "Detect again",
      "Remove",
    ]);
    // 每个按钮都可点击、不被禁用，且完整存在于操作区内（不会被裁掉）。
    for (const button of within(actions).getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
  });

  it("长工具名称与多个状态标签不破坏卡片分区结构", async () => {
    renderPage([
      makeTool({
        id: "d1",
        name: "Very Long Tool Name That Must Ellipsize Without Breaking Layout",
        source: "manual",
        toolType: "desktop",
        isDefault: true,
        isCustom: true,
      }),
    ]);

    const row = await findRow(
      "Very Long Tool Name That Must Ellipsize Without Breaking Layout",
    );
    const [info, actions] = Array.from(row.children) as HTMLElement[];

    expect(row.children.length).toBe(2);
    // 名称行同一行内仍保留默认 / 自定义 / 类型标签。
    const titleRow = within(info).getByText(
      "Very Long Tool Name That Must Ellipsize Without Breaking Layout",
    ).parentElement as HTMLElement;
    expect(within(titleRow).getByText("默认")).toBeInTheDocument();
    expect(within(titleRow).getByText("自定义")).toBeInTheDocument();
    expect(within(titleRow).getByText("桌面应用")).toBeInTheDocument();
    // 操作区结构不受长文本影响：仍是右栏，且按钮齐全（手动 + 已检测 = 4）。
    expect(within(info).queryByRole("button")).toBeNull();
    expect(within(actions).getAllByRole("button").length).toBe(4);
  });

  it("窄窗口下所有按钮仍可访问（结构层面，真实换行见人工验收）", async () => {
    renderPage([makeTool({ id: "d1" })]);
    const row = await findRow("Trae CN");
    const buttons = within(actionAreaOf(row)).getAllByRole("button");

    // jsdom 无法计算真实尺寸/换行，这里只验证按钮未被隐藏、可用且具备可访问名称。
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button).toBeEnabled();
      expect(button.getAttribute("aria-hidden")).toBeNull();
      expect((button.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("已检测工具：设为默认沿用原操作（不改变含义）", async () => {
    renderPage([makeTool({ id: "d1" })]);
    toolsMock.setDefaultTool.mockResolvedValue(emptyState());

    const row = await findRow("Trae CN");
    fireEvent.click(
      within(actionAreaOf(row)).getByRole("button", { name: "设为默认" }),
    );

    await waitFor(() =>
      expect(toolsMock.setDefaultTool).toHaveBeenCalledWith("d1"),
    );
  });

  it("已检测工具：移除仍需二次确认并调用移除操作", async () => {
    renderPage([makeTool({ id: "d1" })]);
    toolsMock.removeTool.mockResolvedValue(emptyState());

    const row = await findRow("Trae CN");
    fireEvent.click(
      within(actionAreaOf(row)).getByRole("button", { name: "移除" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Trae CN/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));
    await waitFor(() => expect(toolsMock.removeTool).toHaveBeenCalledWith("d1"));
  });

  it("已检测工具：配置打开编辑弹窗", async () => {
    renderPage([makeTool({ id: "d1" })]);

    const row = await findRow("Trae CN");
    fireEvent.click(
      within(actionAreaOf(row)).getByRole("button", { name: "配置" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Trae CN")).toBeInTheDocument();
  });

  it("已检测工具：重新检测沿用原操作", async () => {
    renderPage([makeTool({ id: "d1", toolId: "trae" })]);
    toolsMock.detectTools.mockResolvedValue(emptyState());

    const row = await findRow("Trae CN");
    fireEvent.click(
      within(actionAreaOf(row)).getByRole("button", { name: "重新检测" }),
    );

    await waitFor(() =>
      expect(toolsMock.detectTools).toHaveBeenCalledWith("trae"),
    );
  });

  it("未检测工具：手动配置与检测沿用原操作", async () => {
    renderPage([makeBuiltinTool()]);
    toolsMock.detectTools.mockResolvedValue(emptyState());

    const row = await findRow("Trae");
    fireEvent.click(
      within(actionAreaOf(row)).getByRole("button", { name: "手动配置" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // 关闭新增弹窗后再验证检测按钮。
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));

    const reopenedRow = await findRow("Trae");
    fireEvent.click(
      within(actionAreaOf(reopenedRow)).getByRole("button", { name: "检测" }),
    );
    await waitFor(() =>
      expect(toolsMock.detectTools).toHaveBeenCalledWith("trae"),
    );
  });
});
