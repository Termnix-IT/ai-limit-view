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
const setShadowMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  getCurrentWindow: () => ({
    startDragging: vi.fn(), toggleMaximize: vi.fn(), minimize: vi.fn(), close: vi.fn(),
    setSize: (size: { width: number; height: number }) => setSizeMock(size),
    setAlwaysOnTop: (flag: boolean) => setAlwaysOnTopMock(flag),
    setShadow: (flag: boolean) => setShadowMock(flag),
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

function serviceButton(label: "Codex" | "Claude Code") {
  return screen.getByRole("button", { name: `${label}を外側に表示` });
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset(); setSizeMock.mockReset(); setAlwaysOnTopMock.mockReset(); setShadowMock.mockReset();
    mockLimits();
  });

  it("displays live quotas without old plans, recording controls or process status", async () => {
    render(<App />);
    expect(await screen.findByRole("img", { name: /5時間枠：Claude Code 94%、Codex 85%/ })).toBeInTheDocument();
    expect(ring()).toHaveTextContent("94%");
    expect(ring()).not.toHaveTextContent("85%");
    expect(serviceButton("Codex")).toHaveAttribute("aria-pressed", "false");
    expect(serviceButton("Claude Code")).toHaveAttribute("aria-pressed", "true");
    expect(within(ring()).queryByText(/Codex|Claude Code/)).toBeNull();
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
    expect(ring()).toHaveTextContent("—");
    expect(ring()).not.toHaveTextContent("0%");
    expect(screen.getAllByText("取得中")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeDisabled();
  });

  it("switches both rings between five-hour and weekly quotas without saving a plan", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(ring());
    expect(screen.getByRole("img", { name: /週間枠：Claude Code 68%、Codex 80%/ })).toBeInTheDocument();
    expect(ring()).toHaveTextContent("68%");
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
    await waitFor(() => expect(ring()).toHaveTextContent("80%"));
    expect(ring()).not.toHaveTextContent("68%");
    expect(serviceButton("Codex")).toHaveAttribute("aria-pressed", "true");
    expect(serviceButton("Claude Code")).toHaveAttribute("aria-pressed", "false");
    expect(within(ring()).queryByText(/Codex|Claude Code/)).toBeNull();
    await user.click(ring());
    expect(ring()).toHaveAccessibleName(/5時間 \/ Codex/);
    expect(ring()).toHaveTextContent("85%");
  });

  it("selects the outer ring and central percentage by clicking either service icon", async () => {
    const user = userEvent.setup(); render(<App />);
    const image = await screen.findByRole("img", { name: /5時間枠：Claude Code 94%、Codex 85%/ });
    await user.click(serviceButton("Codex"));
    expect(ring()).toHaveTextContent("85%");
    expect(image).toHaveAccessibleName(/外側 Codex/);
    expect(image.querySelector('circle[r="86"][stroke="url(#codexGrad)"]')).not.toBeNull();
    expect(image.querySelector('circle[r="70"][stroke="url(#claudeGrad)"]')).not.toBeNull();
    await user.click(serviceButton("Claude Code"));
    expect(ring()).toHaveTextContent("94%");
    expect(image.querySelector('circle[r="86"][stroke="url(#claudeGrad)"]')).not.toBeNull();
    expect(image.querySelector('circle[r="70"][stroke="url(#codexGrad)"]')).not.toBeNull();
    await user.click(serviceButton("Claude Code"));
    expect(ring()).toHaveAccessibleName(/5時間 \/ Claude Code/);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("keeps weekly scope when selecting a service and supports the scope button", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(screen.getByRole("button", { name: "5時間枠" }));
    await user.click(serviceButton("Codex"));
    expect(ring()).toHaveAccessibleName(/週間 \/ Codex/);
    expect(ring()).toHaveTextContent("80%");
    await user.click(serviceButton("Claude Code"));
    expect(ring()).toHaveTextContent("68%");
    await user.click(screen.getByRole("button", { name: "週間枠" }));
    expect(ring()).toHaveTextContent("94%");
  });

  it("supports service selection using the keyboard", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(serviceButton("Codex"));
    await user.tab();
    expect(serviceButton("Claude Code")).toHaveFocus();
    await user.keyboard(" ");
    expect(serviceButton("Claude Code")).toHaveAttribute("aria-pressed", "true");
    expect(ring()).toHaveTextContent("94%");
  });

  it("shows unavailable weekly quota as unknown instead of using the five-hour value", async () => {
    mockLimits({ ...liveLimits, claude: { ...liveLimits.claude, weekly: null } });
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.click(ring());
    expect(screen.getByRole("img", { name: /週間枠：Claude Code 未取得、Codex 80%/ })).toBeInTheDocument();
    expect(ring()).toHaveTextContent("—");
    expect(ring()).not.toHaveTextContent("80%");
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

  it("keeps a failed selected service unknown while the other service succeeds", async () => {
    mockLimits({ ...liveLimits, claude: {
      ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
      errorCode: "timeout", message: "Claude の取得がタイムアウトしました。再読み込みしてください。",
    } });
    render(<App />);
    expect(await screen.findByText("時間超過")).toBeInTheDocument();
    expect(ring()).toHaveTextContent("—");
    expect(ring()).not.toHaveTextContent("85%");
    fireEvent.wheel(ring(), { deltaY: 1 });
    expect(ring()).toHaveTextContent("85%");
    expect(within(screen.getByRole("region", { name: "Codex 状況" })).getByText("取得済")).toBeInTheDocument();
  });

  it.each([0, 100])("displays a reported %s percent as a valid quota", async (remainingPercent) => {
    mockLimits({ ...liveLimits, claude: {
      ...liveLimits.claude,
      fiveHour: { usedPercent: 100 - remainingPercent, remainingPercent, resetsAt: null },
    } });
    render(<App />);
    await screen.findByRole("img", { name: new RegExp(`Claude Code ${remainingPercent}%`) });
    expect(ring()).toHaveTextContent(`${remainingPercent}%`);
    expect(ring()).not.toHaveTextContent("—");
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
      expect(setShadowMock).toHaveBeenCalledWith(false);
      expect(setSizeMock).toHaveBeenCalledWith(expect.objectContaining({ width: 200, height: 200 }));
    });
    expect(screen.queryByText("Codex")).toBeNull();
    expect(serviceButton("Claude Code")).toBeInTheDocument();
    await user.click(serviceButton("Codex"));
    expect(ring()).toHaveTextContent("85%");
    await user.click(ring());
    expect(ring()).toHaveAccessibleName(/週間/);
    expect(ring()).toHaveTextContent("80%");
    await user.click(screen.getByRole("button", { name: "通常モードに戻す" }));
    await waitFor(() => {
      expect(setAlwaysOnTopMock).toHaveBeenCalledWith(false);
      expect(setShadowMock.mock.calls).toEqual([[false], [true]]);
      expect(setSizeMock).toHaveBeenCalledWith(expect.objectContaining({ width: 400, height: 380 }));
      expect(setShadowMock.mock.invocationCallOrder[1]).toBeLessThan(setSizeMock.mock.invocationCallOrder[1]);
    });
    expect(ring()).toHaveAccessibleName(/週間/);
    expect(serviceButton("Codex")).toHaveAttribute("aria-pressed", "true");
  });

  it("polls Codex every minute and Claude every five minutes", async () => {
    vi.useFakeTimers();
    const view = render(<App />);
    try {
      await act(async () => {});
      await act(async () => { await vi.advanceTimersByTimeAsync(299_000); });
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "codex")).toHaveLength(5);
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "claude_code")).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "claude_code")).toHaveLength(2);
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it("backs off repeated 429s, ignores manual reloads during cooldown and resets after recovery", async () => {
    vi.useFakeTimers();
    let claudeRequests = 0;
    invokeMock.mockImplementation((_command: string, { provider }: { provider: LimitProvider }) => {
      if (provider === "codex") return Promise.resolve(liveLimits.codex);
      claudeRequests += 1;
      return Promise.resolve(claudeRequests < 5 ? {
        ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
        errorCode: "rate_limited", message: "429: 待機後に自動で再試行します。",
      } : liveLimits.claude);
    });
    const view = render(<App />);
    try {
      await act(async () => {});
      expect(screen.getByText("取得制限")).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "再読み込み" })); });
      expect(claudeRequests).toBe(1);
      for (const delay of [300_000, 600_000, 1_200_000, 1_800_000]) {
        const previousRequests = claudeRequests;
        await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1000); });
        expect(claudeRequests).toBe(previousRequests);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(claudeRequests).toBe(previousRequests + 1);
      }
      expect(ring()).toHaveTextContent("94%");
      expect(screen.queryByText("取得制限")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
      expect(claudeRequests).toBe(6);
      expect(invokeMock.mock.calls.filter(([, args]) => args.provider === "codex").length).toBeGreaterThan(50);
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it.each(["server_error", "network_error", "api_error", "timeout", "rejection"])("keeps previous quotas on %s, marks them stale in minimal mode and recovers", async (errorCode) => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    invokeMock.mockImplementation((_command: string, { provider }: { provider: LimitProvider }) => {
      if (provider === "codex") return Promise.resolve(liveLimits.codex);
      if (errorCode === "rejection") return Promise.reject(new Error("private-diagnostic"));
      return Promise.resolve({ ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
        checkedAt: "2026-09-28T00:05:00Z", errorCode, message: "時間をおいて再試行します。" });
    });
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("更新失敗")).toBeInTheDocument();
    expect(ring()).toHaveTextContent("94%");
    expect(ring()).toHaveAccessibleName(/前回の取得値/);
    expect(ring()).toHaveAttribute("title", expect.stringContaining("最終取得 2026-09-28 09:00"));
    expect(document.body).not.toHaveTextContent("private-diagnostic");
    await user.click(screen.getByRole("button", { name: "取得状況" }));
    const details = screen.getByRole("region", { name: "Claude Code 取得状況" });
    expect(details).toHaveTextContent("最終取得2026-09-28 09:00");
    expect(details).toHaveTextContent("次回再試行");
    expect(details).toHaveTextContent("表示中の残量は前回の取得値です。");
    await user.click(screen.getByRole("button", { name: "ミニマル化" }));
    expect(ring()).toHaveAccessibleName(/前回の取得値/);
    expect(document.querySelector(".manaRing__stale")).not.toBeNull();
    await user.click(ring());
    expect(ring()).toHaveTextContent("68%");
    await user.click(screen.getByRole("button", { name: "通常モードに戻す" }));
    mockLimits({ ...liveLimits, claude: { ...liveLimits.claude, checkedAt: "2026-09-28T00:10:00Z",
      fiveHour: { usedPercent: 10, remainingPercent: 90, resetsAt: null }, weekly: null } });
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(screen.queryByText("更新失敗")).toBeNull());
    expect(ring()).toHaveTextContent("—");
    expect(ring()).not.toHaveAccessibleName(/前回の取得値/);
    await user.click(ring());
    expect(ring()).toHaveTextContent("90%");
  });

  it("drops cached quotas when authentication is rejected", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    mockLimits({ ...liveLimits, claude: { ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
      errorCode: "auth_rejected", message: "Claude API が認証・アクセスを拒否しました（403）。" } });
    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("認証拒否")).toBeInTheDocument();
    expect(ring()).toHaveTextContent("—");
    expect(ring()).not.toHaveAccessibleName(/前回の取得値/);
  });

  it("keeps cached quotas through a 429 cooldown and replaces them on the automatic retry", async () => {
    vi.useFakeTimers();
    const view = render(<App />);
    try {
      await act(async () => {});
      mockLimits({ ...liveLimits, claude: { ...liveLimits.claude, status: "unavailable", fiveHour: null, weekly: null,
        errorCode: "rate_limited", message: "429: 待機後に再試行します。" } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "再読み込み" })); });
      expect(ring()).toHaveTextContent("94%");
      expect(ring()).toHaveAccessibleName(/前回の取得値/);
      expect(screen.getByText("更新失敗")).toBeInTheDocument();
      mockLimits({ ...liveLimits, claude: { ...liveLimits.claude,
        fiveHour: { usedPercent: 100, remainingPercent: 0, resetsAt: null } } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "再読み込み" })); });
      expect(ring()).toHaveTextContent("94%");
      await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
      expect(ring()).toHaveTextContent("0%");
      expect(ring()).not.toHaveAccessibleName(/前回の取得値/);
      expect(screen.queryByText("更新失敗")).toBeNull();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it("keeps normal controls available if the native shadow change fails", async () => {
    setShadowMock.mockRejectedValueOnce(new Error("Native shadow update failed"));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole("button", { name: "ミニマル化" }));
    expect(await screen.findByText("Error: Native shadow update failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ミニマル化" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通常モードに戻す" })).toBeNull();
    expect(setSizeMock).not.toHaveBeenCalled();
  });
});
