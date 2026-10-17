import { describe, expect, it } from "vitest";
import { resolveDefaultTool, toolIsLaunchable } from "./health";
import type { ToolEntry } from "../../types/domain";

function tool(overrides: Partial<ToolEntry> = {}): ToolEntry {
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

describe("resolveDefaultTool", () => {
  it("未设置默认工具时为 unset", () => {
    expect(resolveDefaultTool(null, [tool()]).state).toBe("unset");
  });

  it("已设置、已检测到且可启动时为 ready", () => {
    const result = resolveDefaultTool("install-1", [tool()]);
    expect(result.state).toBe("ready");
    expect(result.tool?.id).toBe("install-1");
  });

  it("已设置但当前未检测到时为 notDetected", () => {
    const entry = tool({
      status: "notDetected",
      installed: false,
      launch: { support: "unavailable", method: null, reason: "尚未检测到" },
    });
    expect(resolveDefaultTool("install-1", [entry]).state).toBe("notDetected");
  });

  it("已检测到但无法受控启动时为 notLaunchable", () => {
    const entry = tool({
      launch: { support: "needsConfiguration", method: null, reason: "缺少路径" },
    });
    expect(resolveDefaultTool("install-1", [entry]).state).toBe("notLaunchable");
  });

  it("对应工具配置已被移除时为 removed", () => {
    expect(resolveDefaultTool("install-x", [tool()]).state).toBe("removed");
  });
});

describe("toolIsLaunchable", () => {
  it("仅已检测到且可受控启动的工具为 true", () => {
    expect(toolIsLaunchable(tool())).toBe(true);
    expect(
      toolIsLaunchable(
        tool({
          installed: false,
          status: "notDetected",
          launch: { support: "unavailable", method: null, reason: "" },
        }),
      ),
    ).toBe(false);
    expect(
      toolIsLaunchable(
        tool({
          launch: { support: "unsupported", method: null, reason: "" },
        }),
      ),
    ).toBe(false);
  });
});
