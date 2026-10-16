import { describe, expect, it } from "vitest";
import type { ToolEntry, ToolSource, ToolStatus } from "../../types/domain";
import { getToolRowActions } from "./data";

type Row = Pick<ToolEntry, "source" | "status" | "installed" | "isDefault">;

function row(
  source: ToolSource,
  status: ToolStatus,
  overrides: Partial<Row> = {},
): Row {
  return { source, status, installed: status === "detected", isDefault: false, ...overrides };
}

describe("getToolRowActions", () => {
  it("offers manual config and a first detect for a builtin placeholder", () => {
    expect(getToolRowActions(row("builtin", "notDetected"))).toEqual([
      "manualConfig",
      "detect",
    ]);
  });

  it("offers redetect (never revalidate) for auto-detected tools", () => {
    const actions = getToolRowActions(row("auto", "detected"));
    expect(actions).toContain("redetect");
    expect(actions).not.toContain("revalidate");
    expect(actions).not.toContain("detect");
    expect(actions).toEqual(["setDefault", "configure", "redetect", "remove"]);
  });

  it("does not repeat a detect action for a valid manual tool", () => {
    const actions = getToolRowActions(row("manual", "detected"));
    expect(actions).toEqual(["setDefault", "configure", "remove"]);
    expect(actions).not.toContain("detect");
    expect(actions).not.toContain("redetect");
    expect(actions).not.toContain("revalidate");
  });

  it.each(["pathMissing", "unverified", "detectionFailed"] as const)(
    "offers revalidate (not detect) for a manual tool with status %s",
    (status) => {
      const actions = getToolRowActions(row("manual", status));
      expect(actions).toContain("revalidate");
      expect(actions).not.toContain("detect");
      expect(actions).not.toContain("redetect");
      expect(actions).toEqual(["configure", "revalidate", "remove"]);
    },
  );

  it("toggles the default action based on the current default flag", () => {
    expect(getToolRowActions(row("auto", "detected", { isDefault: true }))).toEqual([
      "unsetDefault",
      "configure",
      "redetect",
      "remove",
    ]);
  });

  it("omits the default action when the tool is not installed", () => {
    const actions = getToolRowActions(row("manual", "pathMissing"));
    expect(actions).not.toContain("setDefault");
    expect(actions).not.toContain("unsetDefault");
  });
});
