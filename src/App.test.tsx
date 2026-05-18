import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Dashboard, SettingsView } from "./types";

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
    process_monitor_enabled: "1",
    codex_process_names: "codex.exe,codex",
    claude_code_process_names: "claude.exe,claude-code.exe,claude",
  },
  databasePath: "C:\\Users\\example\\ai-limitusage-watcher.db",
  officialUrls: {
    codex: "https://platform.openai.com/usage",
    claude_code: "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics",
  },
};

function mockBaseResponses(dashboard: Dashboard = emptyDashboard) {
  invokeMock.mockImplementation((command: string) => {
    if (command === "get_dashboard") return Promise.resolve(dashboard);
    if (command === "get_settings") return Promise.resolve(settings);
    if (command === "scan_process_usage") return Promise.resolve();
    if (command === "update_settings") return Promise.resolve();
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockBaseResponses();
  });

  it("renders only the simplified usage dashboard", async () => {
    render(<App />);

    expect(await screen.findByText("使用状況")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.queryByText("Official Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Log")).not.toBeInTheDocument();
    expect(screen.queryByText("Input")).not.toBeInTheDocument();
  });

  it("shows estimated remaining usage room from the high minutes setting", async () => {
    mockBaseResponses({
      ...emptyDashboard,
      tools: [
        { ...emptyDashboard.tools[0], estimatedMinutesToday: 60 },
        { ...emptyDashboard.tools[1], estimatedMinutesToday: 180 },
      ],
    });

    render(<App />);

    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("opens settings from the gear button and saves Japanese-labeled settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "設定" }));
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByLabelText("上限ライン 分")).toHaveValue(240);
    expect(screen.getByLabelText("プロセス監視")).toHaveValue("1");

    await user.clear(screen.getByLabelText("上限ライン 分"));
    await user.type(screen.getByLabelText("上限ライン 分"), "300");
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_settings",
        expect.objectContaining({
          entries: expect.arrayContaining([
            { key: "high_minutes", value: "300" },
          ]),
        }),
      );
    });
  });
});
