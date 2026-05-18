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
  date: "2026-05-19",
  tools: [
    {
      tool: "codex",
      label: "Codex",
      launchCountToday: 0,
      estimatedMinutesToday: 0,
      estimatedMinutesWindow: 0,
      windowMinutes: 300,
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
      estimatedMinutesWindow: 0,
      windowMinutes: 300,
      lastUsedAt: null,
      latestStatusSummary: null,
      statusSaved: false,
      latestManualRemaining: null,
      attentionLevel: "low",
      officialUsageUrl:
        "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics",
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
    codex_medium_minutes: "120",
    codex_high_minutes: "240",
    codex_hour_window_minutes: "300",
    codex_hour_high_minutes: "60",
    claude_code_medium_minutes: "120",
    claude_code_high_minutes: "360",
    claude_code_hour_window_minutes: "10080",
    claude_code_hour_high_minutes: "360",
    claude_code_session_window_minutes: "300",
    claude_code_session_message_limit: "45",
    claude_code_session_token_limit: "70000000",
    claude_code_weekly_window_minutes: "10080",
    claude_code_weekly_message_limit: "200",
    claude_code_weekly_token_limit: "750000000",
    claude_code_weekly_reset_weekday: "wednesday",
    claude_code_weekly_reset_hour: "18",
    claude_code_plan: "pro",
    claude_code_burn_window_minutes: "30",
    medium_launches: "5",
    high_launches: "10",
    process_monitor_enabled: "1",
    codex_process_names: "codex.exe,codex",
    claude_code_process_names: "claude.exe,claude-code.exe,claude",
  },
  databasePath: "C:\\Users\\example\\ai-limitusage-watcher.db",
  officialUrls: {
    codex: "https://platform.openai.com/usage",
    claude_code:
      "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics",
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

  it("renders the mana status dashboard with both tool rails", async () => {
    render(<App />);

    expect(await screen.findByText("MANA STATUS")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    // Two MANA % readouts in the centre (CX + CC), both 100% on empty data.
    expect(screen.getAllByText("100%")).toHaveLength(2);
    expect(screen.getAllByText("出力")).toHaveLength(2);
    expect(screen.getAllByText("リチャージ")).toHaveLength(2);
  });

  it("reflects Claude Code quota numbers in the chip rail", async () => {
    mockBaseResponses({
      ...emptyDashboard,
      tools: [
        { ...emptyDashboard.tools[0], estimatedMinutesWindow: 6 },
        {
          ...emptyDashboard.tools[1],
          quotaSessionUsed: 14_000_000,
          quotaSessionLimit: 70_000_000,
          quotaSessionResetAt: "2026-05-19T02:00:00Z",
          quotaSessionWindowMinutes: 300,
          quotaSessionStartedAt: "2026-05-18T21:00:00Z",
          quotaBurnRateTokensPerMin: 300_000,
          quotaProjectedDepletionAt: "2026-05-19T01:00:00Z",
          quotaPlan: "pro",
        },
      ],
    });

    render(<App />);

    // Claude Code MANA = 80% remaining (14M of 70M used).
    expect(await screen.findByText("80%")).toBeInTheDocument();
    // Burn rate chip on Claude side.
    expect(screen.getByText("300.0k tok/分")).toBeInTheDocument();
    // Codex pace chip: 6 min over 300min window → 1.2 分/h.
    expect(screen.getByText("1.2 分/h")).toBeInTheDocument();
  });

  it("opens settings and switches the Claude plan to custom", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "設定" }));
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex 上限ライン 分")).toHaveValue(240);
    expect(screen.getByLabelText("Claude Code プラン")).toHaveValue("pro");
    expect(screen.getByLabelText("プロセス監視")).toHaveValue("1");

    await user.selectOptions(screen.getByLabelText("Claude Code プラン"), "custom");
    expect(screen.getByLabelText("Claude Code 5時間枠トークン上限 (Custom)")).toHaveValue(
      70_000_000,
    );
    await user.clear(screen.getByLabelText("Claude Code 5時間枠トークン上限 (Custom)"));
    await user.type(
      screen.getByLabelText("Claude Code 5時間枠トークン上限 (Custom)"),
      "90000000",
    );
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_settings",
        expect.objectContaining({
          entries: expect.arrayContaining([
            { key: "claude_code_plan", value: "custom" },
            { key: "claude_code_session_token_limit", value: "90000000" },
          ]),
        }),
      );
    });
  });
});
