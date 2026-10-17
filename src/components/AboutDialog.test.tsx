import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { RevisionProvider } from "../context/RevisionContext";
import { ToolsProvider } from "../context/ToolsContext";
import type { ToolEntry } from "../types/domain";
import { AboutDialog } from "./AboutDialog";

vi.mock("../context/AppContext", () => ({
  useApp: () => ({ aboutOpen: true, closeAbout: () => undefined }),
}));

vi.mock("../services/tools", () => ({
  listTools: vi.fn(),
}));

import * as toolsApi from "../services/tools";

const toolsApiMock = toolsApi as unknown as {
  listTools: ReturnType<typeof vi.fn>;
};

function tool(id: string, toolId: string, name: string): ToolEntry {
  return {
    id,
    toolId,
    name,
    vendor: "vendor",
    description: "",
    toolType: "cli",
    source: "builtin",
    status: "detected",
    executablePath: null,
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

function renderAbout() {
  return render(
    <I18nProvider>
      <RevisionProvider>
        <ToolsProvider>
          <AboutDialog />
        </ToolsProvider>
      </RevisionProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  toolsApiMock.listTools.mockResolvedValue({
    entries: [tool("opencode", "opencode", "OpenCode"), tool("trae", "trae", "Trae")],
    lastDetectionAt: null,
  });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("关于页面：面向普通用户的产品介绍", () => {
  it("展示品牌、核心功能、支持的工具与版本，且不含技术栈/内部实现说明", async () => {
    renderAbout();

    expect(screen.getByText("关于 VibeAcross")).toBeInTheDocument();
    expect(screen.getByText("AI 编程工具与项目会话管理工具")).toBeInTheDocument();

    // 核心功能四项。
    expect(screen.getByText("项目管理")).toBeInTheDocument();
    expect(screen.getByText("AI 编程工具切换")).toBeInTheDocument();
    expect(screen.getByText("会话管理")).toBeInTheDocument();
    expect(screen.getByText("项目与会话关联")).toBeInTheDocument();

    // 支持的工具来自工具注册表（后端数据）。
    const toolList = screen.getByText("支持的 AI 编程工具").closest("section")!;
    expect(await within(toolList).findByText("OpenCode")).toBeInTheDocument();
    expect(within(toolList).getByText("Trae")).toBeInTheDocument();

    // 版本信息复用应用版本。
    expect(screen.getByText("版本 0.2.0")).toBeInTheDocument();

    // 不再展示技术栈 / 后端通信示例等开发者内容。
    expect(screen.queryByText("技术栈")).not.toBeInTheDocument();
    expect(screen.queryByText("后端通信示例")).not.toBeInTheDocument();
    expect(screen.queryByText("React 19")).not.toBeInTheDocument();
    expect(screen.queryByText("后端版本")).not.toBeInTheDocument();
  });
});
