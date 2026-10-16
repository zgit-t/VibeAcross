import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("渲染文本内容", () => {
    render(<Badge tone="success">可恢复</Badge>);
    expect(screen.getByText("可恢复")).toBeInTheDocument();
  });

  it("随图标一起渲染", () => {
    render(<Badge icon={<span data-testid="icon" />}>警告</Badge>);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("警告")).toBeInTheDocument();
  });
});
