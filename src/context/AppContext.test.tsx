import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider, useApp } from "./AppContext";

let api: ReturnType<typeof useApp> | null = null;

function Probe() {
  api = useApp();
  return (
    <div>
      <span data-testid="view">{api.activeView}</span>
      <span data-testid="pending">{api.pendingProjectId ?? "none"}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <AppProvider>
      <Probe />
    </AppProvider>,
  );
}

describe("AppContext 项目深链（BUG-04）", () => {
  it("openProject 切换到 Projects 并记录待打开项目", () => {
    renderProbe();
    act(() => api!.openProject("p-1"));
    expect(screen.getByTestId("view")).toHaveTextContent("projects");
    expect(screen.getByTestId("pending")).toHaveTextContent("p-1");
  });

  it("clearPendingProject 清除待打开项目", () => {
    renderProbe();
    act(() => api!.openProject("p-2"));
    act(() => api!.clearPendingProject());
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("navigate 会清除待打开项目", () => {
    renderProbe();
    act(() => api!.openProject("p-3"));
    act(() => api!.navigate("tools"));
    expect(screen.getByTestId("view")).toHaveTextContent("tools");
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });
});
