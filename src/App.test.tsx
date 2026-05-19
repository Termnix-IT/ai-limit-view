import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Dashboard, SettingsView } from "./types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

const setSizeMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    setSize: (size: { width: number; height: number }) => setSizeMock(size),
    setAlwaysOnTop: (flag: boolean) => setAlwaysOnTopMock(flag),
  }),
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
      quotaPlan: "pro",
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
    claude_code_plan: "pro",
    claude_code_session_window_minutes: "300",
    claude_code_session_token_limit: "70000000",
    claude_code_burn_window_minutes: "30",
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
    setSizeMock.mockReset();
    setAlwaysOnTopMock.mockReset();
    mockBaseResponses();
  });

  it("renders the mana status dashboard with both tool rails", async () => {
    render(<App />);

    expect(await screen.findByText("MANA STATUS")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("100%")).toHaveLength(2);
    expect(screen.getAllByText("出力")).toHaveLength(2);
    expect(screen.getByText("枠残り")).toBeInTheDocument();
    expect(screen.getByText("リチャージ")).toBeInTheDocument();
    // No settings button in titlebar anymore.
    expect(screen.queryByRole("button", { name: "設定" })).toBeNull();
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

    expect(await screen.findByText("80%")).toBeInTheDocument();
    expect(screen.getByText("300.0k tok/分")).toBeInTheDocument();
    expect(screen.getByText("1.2 分/h")).toBeInTheDocument();
  });

  it("cycles the Claude plan when the mana ring center is tapped", async () => {
    const user = userEvent.setup();
    render(<App />);

    const ringButton = await screen.findByRole("button", { name: /プラン切替/ });
    expect(ringButton).toHaveAccessibleName(/Pro/);

    await user.click(ringButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_settings",
        expect.objectContaining({
          entries: [{ key: "claude_code_plan", value: "max5" }],
        }),
      );
    });
  });

  it("enters minimal mode and exits via the hover restore button", async () => {
    const user = userEvent.setup();
    render(<App />);

    const minimalBtn = await screen.findByRole("button", { name: "ミニマル化" });
    await user.click(minimalBtn);

    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(true);
      expect(setSizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ width: 200, height: 200 }),
      );
    });

    expect(screen.queryByRole("button", { name: "ミニマル化" })).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();

    const exitBtn = await screen.findByRole("button", { name: "通常モードに戻す" });
    await user.click(exitBtn);

    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(false);
      expect(setSizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ width: 400, height: 380 }),
      );
    });

    expect(await screen.findByRole("button", { name: "ミニマル化" })).toBeInTheDocument();
  });
});
