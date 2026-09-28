import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { LimitProvider, LiveLimits, LiveProviderLimits } from "./types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

const setSizeMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  getCurrentWindow: () => ({
    startDragging: vi.fn(), toggleMaximize: vi.fn(), minimize: vi.fn(), close: vi.fn(),
    setSize: (size: { width: number; height: number }) => setSizeMock(size),
    setAlwaysOnTop: (flag: boolean) => setAlwaysOnTopMock(flag),
  }),
}));

const liveLimits: { codex: LiveProviderLimits; claude: LiveProviderLimits } = {
  codex: {
    status: "ok", source: "Codex app-server", checkedAt: "2026-09-28T00:00:00Z",
    fiveHour: { usedPercent: 15, remainingPercent: 85, resetsAt: 1790580000 },
    weekly: { usedPercent: 20, remainingPercent: 80, resetsAt: 1791052785 },
    message: null, errorCode: null,
  },
  claude: {
    status: "ok", source: "OpenUsage", checkedAt: "2026-09-28T00:00:00Z",
    fiveHour: { usedPercent: 6, remainingPercent: 94, resetsAt: "2026-09-28T03:00:00Z" },
    weekly: { usedPercent: 32, remainingPercent: 68, resetsAt: "2026-09-30T09:00:00Z" },
    message: null, errorCode: null,
  },
};

function mockLimits(limits: LiveLimits = liveLimits) {
  invokeMock.mockImplementation((command: string, args: { provider: LimitProvider }) => {
    if (command === "get_provider_limits") return Promise.resolve(args.provider === "codex" ? limits.codex : limits.claude);
    return Promise.reject(new Error(`Unexpected legacy command: ${command}`));
  });
}

function ring() {
  return screen.getByRole("button", { name: /残量枠切替/ });
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset(); setSizeMock.mockReset(); setAlwaysOnTopMock.mockReset();
    mockLimits();
  });

  it("displays live quotas without old plans, recording controls or process status", async () => {
    render(<App />);
    expect(await screen.findByRole("img", { name: /5時間枠：Claude Code 94%、Codex 85%/ })).toBeInTheDocument();
    expect(screen.getAllByText("5h残")).toHaveLength(2);
    expect(screen.getAllByText("週残")).toHaveLength(2);
    expect(screen.getAllByText("取得済")).toHaveLength(2);
    expect(screen.queryByText(/Pro|Max 5x|Max 20x|稼働中|待機中|未記録/)).toBeNull();
    expect(invokeMock.mock.calls).toEqual([
      ["get_provider_limits", { provider: "codex" }],
      ["get_provider_limits", { provider: "claude_code" }],
    ]);
  });

  it("shows the ring and fetching state while quota retrieval is pending", () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(ring()).toHaveAccessibleName(/5時間/);
    expect(screen.getAllByText("取得中")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeDisabled();
  });

  it("switches both rings between five-hour and weekly quotas without saving a plan", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(ring());
    expect(screen.getByRole("img", { name: /週間枠：Claude Code 68%、Codex 80%/ })).toBeInTheDocument();
    expect(screen.getAllByText("週回復")).toHaveLength(2);
    await user.click(ring());
    expect(screen.getByRole("img", { name: /5時間枠：Claude Code 94%、Codex 85%/ })).toBeInTheDocument();
    expect(screen.getAllByText("5h回復")).toHaveLength(2);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("switches the highlighted tool with the wheel while keeping the quota scope", async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(ring());
    fireEvent.wheel(ring(), { deltaY: 1 });
    expect(ring()).toHaveAccessibleName(/週間 \/ Codex/);
    await user.click(ring());
    expect(ring()).toHaveAccessibleName(/5時間 \/ Codex/);
  });

  it("shows unavailable weekly quota as unknown instead of using the five-hour value", async () => {
    mockLimits({ ...liveLimits, claude: { ...liveLimits.claude, weekly: null } });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(ring());
    expect(screen.getByRole("img", { name: /週間枠：Claude Code 未取得、Codex 80%/ })).toBeInTheDocument();
    const rail = screen.getByRole("region", { name: "Claude Code 状況" });
    expect(within(rail).getAllByText("—")).toHaveLength(2);
  });

  it("replaces the old input screen with retrieval sources, timestamps and reset details", async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole("button", { name: "取得状況" }));
    expect(await screen.findByRole("heading", { name: "取得状況" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("保存")).toBeNull();
    expect(screen.getByText("Codex app-server")).toBeInTheDocument();
    expect(screen.getByText("OpenUsage")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-28 09:00")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "再取得" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
    await user.click(screen.getByRole("button", { name: "取得状況を閉じる" }));
    expect(ring()).toBeInTheDocument();
  });

  it("reports expired authentication and preserves the other service's quotas", async () => {
    mockLimits({ ...liveLimits, claude: {
      ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
      errorCode: "auth_expired", message: "Claude Code の認証期限が切れています。/login 後に再読み込みしてください。",
    } });
    const user = userEvent.setup(); render(<App />);
    expect(await screen.findByText("要認証")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Claude Code 未取得、Codex 85%/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Claude Code 残量取得の詳細" }));
    expect(screen.getByRole("status")).toHaveTextContent("/login 後に再読み込み");
    await user.click(screen.getByRole("button", { name: "取得状況" }));
    expect(screen.getByRole("status")).toHaveTextContent("/login 後に再読み込み");
  });

  it("reports command failure instead of remaining in fetching state", async () => {
    invokeMock.mockRejectedValue(new Error("backend unavailable")); render(<App />);
    expect(await screen.findAllByText("取得失敗")).toHaveLength(2);
    expect(screen.queryByText("取得中")).toBeNull();
  });

  it.each(["codex", "claude_code"] as const)("displays %s immediately while the other service is pending", async (fast) => {
    let resolveSlow!: (value: LiveProviderLimits) => void;
    const pending = new Promise<LiveProviderLimits>((resolve) => { resolveSlow = resolve; });
    invokeMock.mockImplementation((_command: string, { provider }: { provider: LimitProvider }) =>
      provider === fast ? Promise.resolve(fast === "codex" ? liveLimits.codex : liveLimits.claude) : pending);
    render(<App />);
    const expected = fast === "codex" ? /Claude Code 未取得、Codex 85%/ : /Claude Code 94%、Codex 未取得/;
    expect(await screen.findByRole("img", { name: expected })).toBeInTheDocument();
    expect(screen.getAllByText("取得中")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeDisabled();
    await act(async () => { resolveSlow(fast === "codex" ? liveLimits.claude : liveLimits.codex); });
    expect(screen.getByRole("img", { name: /Claude Code 94%、Codex 85%/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeEnabled();
  });

  it("preserves Codex when the Claude command rejects", async () => {
    invokeMock.mockImplementation((_command: string, { provider }: { provider: LimitProvider }) =>
      provider === "codex" ? Promise.resolve(liveLimits.codex) : Promise.reject(new Error("unavailable")));
    render(<App />);
    expect(await screen.findByRole("img", { name: /Claude Code 未取得、Codex 85%/ })).toBeInTheDocument();
    expect(screen.getAllByText("取得失敗")).toHaveLength(1);
  });

  it("continues polling the ready service without duplicating an unfinished request", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((_command: string, { provider }: { provider: LimitProvider }) =>
        provider === "codex" ? Promise.resolve(liveLimits.codex) : new Promise(() => {}));
      const view = render(<App />);
      await act(async () => {});
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "codex")).toHaveLength(2);
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "claude_code")).toHaveLength(1);
      view.unmount();
    } finally { vi.useRealTimers(); }
  });

  it("supports scope switching in minimal mode and preserves it after restoring", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(screen.getByRole("button", { name: "ミニマル化" }));
    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(true);
      expect(setSizeMock).toHaveBeenCalledWith(expect.objectContaining({ width: 200, height: 200 }));
    });
    expect(screen.queryByText("Codex")).toBeNull();
    await user.click(ring());
    expect(ring()).toHaveAccessibleName(/週間/);
    await user.click(screen.getByRole("button", { name: "通常モードに戻す" }));
    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(false);
      expect(setSizeMock).toHaveBeenCalledWith(expect.objectContaining({ width: 400, height: 380 }));
    });
    expect(ring()).toHaveAccessibleName(/週間/);
  });
});
