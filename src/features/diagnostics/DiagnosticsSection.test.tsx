import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../context/AppContext";
import { I18nProvider } from "../../i18n";
import { DiagnosticsSection } from "./DiagnosticsSection";

vi.mock("../../services/diagnostics", () => ({
  getDiagnosticsInfo: vi.fn(),
  getDiagnosticsContent: vi.fn(),
  clearDiagnostics: vi.fn(),
  openDiagnosticsLocation: vi.fn(),
  suggestedDiagnosticsFileName: vi.fn(),
  exportDiagnostics: vi.fn(),
}));

vi.mock("../../services/dialog", () => ({
  pickSaveFile: vi.fn(),
}));

import * as diagnosticsApi from "../../services/diagnostics";
import * as dialogApi from "../../services/dialog";

const diagnosticsMock = diagnosticsApi as unknown as {
  getDiagnosticsInfo: ReturnType<typeof vi.fn>;
  getDiagnosticsContent: ReturnType<typeof vi.fn>;
  clearDiagnostics: ReturnType<typeof vi.fn>;
  openDiagnosticsLocation: ReturnType<typeof vi.fn>;
  suggestedDiagnosticsFileName: ReturnType<typeof vi.fn>;
  exportDiagnostics: ReturnType<typeof vi.fn>;
};
const dialogMock = dialogApi as unknown as {
  pickSaveFile: ReturnType<typeof vi.fn>;
};

const LOG_PATH = "C:\\Temp\\vibeacross-opencode.log";

function renderSection() {
  return render(
    <AppProvider>
      <I18nProvider>
        <DiagnosticsSection />
      </I18nProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe("DiagnosticsSection", () => {
  it("已有日志时展示位置与大小", async () => {
    diagnosticsMock.getDiagnosticsInfo.mockResolvedValue({
      path: LOG_PATH,
      exists: true,
      sizeBytes: 2048,
    });
    renderSection();
    expect(await screen.findByText(LOG_PATH)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it("尚无日志时禁用导出按钮", async () => {
    diagnosticsMock.getDiagnosticsInfo.mockResolvedValue({
      path: LOG_PATH,
      exists: false,
      sizeBytes: 0,
    });
    renderSection();
    const button = await screen.findByRole("button", { name: "导出日志" });
    expect(button).toBeDisabled();
  });

  it("导出时把日志保存到所选路径", async () => {
    diagnosticsMock.getDiagnosticsInfo.mockResolvedValue({
      path: LOG_PATH,
      exists: true,
      sizeBytes: 1024,
    });
    diagnosticsMock.suggestedDiagnosticsFileName.mockResolvedValue(
      "VibeAcross-diagnostics-20260101-000000.log",
    );
    dialogMock.pickSaveFile.mockResolvedValue("D:\\out\\diag.log");
    diagnosticsMock.exportDiagnostics.mockResolvedValue({
      path: "D:\\out\\diag.log",
      exists: true,
      sizeBytes: 1024,
    });

    renderSection();
    const button = await screen.findByRole("button", { name: "导出日志" });
    button.click();

    expect(await screen.findByText(/已保存到 diag\.log/)).toBeInTheDocument();
    expect(diagnosticsMock.exportDiagnostics).toHaveBeenCalledWith(
      "D:\\out\\diag.log",
      false,
    );
  });

  it("查看日志时展示内容", async () => {
    diagnosticsMock.getDiagnosticsInfo.mockResolvedValue({
      path: LOG_PATH,
      exists: true,
      sizeBytes: 128,
    });
    diagnosticsMock.getDiagnosticsContent.mockResolvedValue({
      path: LOG_PATH,
      content: "[t] hello marker",
      truncated: false,
      sizeBytes: 128,
    });

    renderSection();
    (await screen.findByRole("button", { name: "查看日志" })).click();

    expect(await screen.findByText(/hello marker/)).toBeInTheDocument();
    expect(diagnosticsMock.getDiagnosticsContent).toHaveBeenCalled();
  });

  it("清空日志前需确认，确认后调用后端", async () => {
    diagnosticsMock.getDiagnosticsInfo.mockResolvedValue({
      path: LOG_PATH,
      exists: true,
      sizeBytes: 128,
    });
    diagnosticsMock.clearDiagnostics.mockResolvedValue({
      path: LOG_PATH,
      exists: false,
      sizeBytes: 0,
    });

    renderSection();
    (await screen.findByRole("button", { name: "清空日志" })).click();

    const confirm = await screen.findByRole("button", { name: "清空" });
    confirm.click();

    expect(await screen.findByText("诊断日志已清空。")).toBeInTheDocument();
    expect(diagnosticsMock.clearDiagnostics).toHaveBeenCalled();
  });
});
