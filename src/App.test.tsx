import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Dashboard, SettingsView, UsageSession } from "./types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

const emptyDashboard: Dashboard = {
  date: "2026-05-04",
  tools: [
    {
      tool: "codex",
      label: "Codex",
      launchCountToday: 0,
      estimatedMinutesToday: 0,
      lastUsedAt: null,
      latestStatusSummary: null,
      statusSaved: false,
      latestManualRemaining: null,
      attentionLevel: "low",
      officialUsageUrl: "https://platform.openai.com/usage",
      isRunning: false,
      activeSessionStartedAt: null,
    },
    {
      tool: "claude_code",
      label: "Claude Code",
      launchCountToday: 0,
      estimatedMinutesToday: 0,
      lastUsedAt: null,
      latestStatusSummary: null,
      statusSaved: false,
      latestManualRemaining: null,
      attentionLevel: "low",
      officialUsageUrl: "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics",
      isRunning: false,
      activeSessionStartedAt: null,
    },
  ],
  recentLogs: [],
};

const settings: SettingsView = {
  values: {
    medium_minutes: "120",
    high_minutes: "240",
    medium_launches: "5",
    high_launches: "10",
  },
  databasePath: "C:\\Users\\example\\ai-limitusage-watcher.db",
  officialUrls: {
    codex: "https://platform.openai.com/usage",
    claude_code: "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics",
  },
};

function mockBaseResponses(dashboard: Dashboard = emptyDashboard, logs: UsageSession[] = []) {
  invokeMock.mockImplementation((command: string) => {
    if (command === "get_dashboard") return Promise.resolve(dashboard);
    if (command === "list_usage_logs") return Promise.resolve(logs);
    if (command === "get_settings") return Promise.resolve(settings);
    if (command === "scan_process_usage") return Promise.resolve();
    if (command === "save_status_snapshot") return Promise.resolve(1);
    if (command === "create_usage_session") return Promise.resolve(1);
    if (command === "delete_usage_session") return Promise.resolve();
    if (command === "save_manual_limit_entry") return Promise.resolve(1);
    if (command === "update_settings") return Promise.resolve();
    if (command === "open_official_usage_url") return Promise.resolve();
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockBaseResponses();
  });

  it("renders an empty dashboard state", async () => {
    render(<App />);

    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("今日 0分").length).toBeGreaterThan(0);
  });

  it("saves pasted status through the Tauri command", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Input" }));
    await user.type(screen.getByPlaceholderText("例: /status結果: 保存済み"), "/status結果: 保存済み");
    await user.type(screen.getByLabelText("Raw text"), "Codex status sample");
    await user.click(screen.getByRole("button", { name: "Save Status" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_status_snapshot",
        expect.objectContaining({
          input: expect.objectContaining({
            tool: "codex",
            rawText: "Codex status sample",
            summaryText: "/status結果: 保存済み",
          }),
        }),
      );
    });
  });

  it("shows estimated remaining usage room from the high minutes setting", async () => {
    mockBaseResponses({
      ...emptyDashboard,
      tools: [
        { ...emptyDashboard.tools[0], estimatedMinutesToday: 60 },
        { ...emptyDashboard.tools[1], estimatedMinutesToday: 180 },
        {
          ...emptyDashboard.tools[1],
          tool: "codex",
          label: "Codex Max",
          estimatedMinutesToday: 260,
        },
      ],
    });

    render(<App />);

    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
