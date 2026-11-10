import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { LimitProvider, LiveProviderLimits } from "./types";

interface MockItem { text?: string; item?: string; checked?: boolean; enabled?: boolean; action?: () => void; items?: MockItem[] }

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.12") }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

const setSizeMock = vi.fn();
const setAlwaysOnTopMock = vi.fn();
const minimizeMock = vi.fn();
const closeMock = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  getCurrentWindow: () => ({
    startDragging: vi.fn(), toggleMaximize: vi.fn(), minimize: minimizeMock, close: closeMock,
    setSize: (size: { width: number; height: number }) => setSizeMock(size),
    setAlwaysOnTop: (flag: boolean) => setAlwaysOnTopMock(flag),
  }),
}));

const menuNewMock = vi.fn();
const popupMock = vi.fn();
const menuCloseMock = vi.fn();
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: (options: { items: MockItem[] }) => {
      menuNewMock(options.items);
      return Promise.resolve({ popup: popupMock, close: menuCloseMock });
    },
  },
}));

const limits: Record<"codex" | "claude", LiveProviderLimits> = {
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

function ring() {
  return screen.getByRole("button", { name: /残量枠切替/ });
}

/** Right-clicks the target and returns the items of the menu that was shown. */
async function openMenu(target: Element = ring()): Promise<MockItem[]> {
  menuNewMock.mockClear();
  fireEvent.contextMenu(target);
  await waitFor(() => expect(popupMock).toHaveBeenCalled());
  popupMock.mockClear();
  return menuNewMock.mock.calls[0][0] as MockItem[];
}

function find(items: MockItem[], ...path: string[]): MockItem {
  const [head, ...rest] = path;
  const found = items.find((item) => item.text === head);
  if (!found) throw new Error(`menu item not found: ${head}`);
  return rest.length ? find(found.items ?? [], ...rest) : found;
}

async function choose(items: MockItem[], ...path: string[]) {
  await act(async () => { find(items, ...path).action?.(); });
}

describe("context menu", () => {
  beforeEach(() => {
    for (const mock of [invokeMock, setSizeMock, setAlwaysOnTopMock, minimizeMock, closeMock, menuNewMock, popupMock, menuCloseMock]) mock.mockReset();
    popupMock.mockResolvedValue(undefined); menuCloseMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation((command: string, args: { provider: LimitProvider }) => {
      if (command === "get_provider_limits") return Promise.resolve(args.provider === "codex" ? limits.codex : limits.claude);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it("replaces the WebView menu with the app menu but keeps editable fields untouched", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    ring().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(popupMock).toHaveBeenCalledWith());
    const items = menuNewMock.mock.calls[0][0] as MockItem[];
    expect(items.map((item) => item.text ?? item.item)).toEqual(["ミニマル化", "最前面に固定", "再読み込み", "Separator",
      "表示枠", "外側のサービス", "Separator", "取得状況", "オプション", "Separator", "最小化", "閉じる"]);
    expect(find(items, "最前面に固定").checked).toBe(false);
    expect(find(items, "表示枠").items?.map((item) => [item.text, item.checked])).toEqual([["5時間", true], ["週間", false]]);
    expect(find(items, "外側のサービス").items?.map((item) => [item.text, item.checked]))
      .toEqual([["Codex", false], ["Claude Code", true]]);

    const input = document.createElement("input");
    document.body.append(input);
    const inputEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    input.dispatchEvent(inputEvent);
    expect(inputEvent.defaultPrevented).toBe(false);
    input.remove();
  });

  it("selects the scope and outer service from the menu", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await choose(await openMenu(), "表示枠", "週間");
    expect(ring()).toHaveAccessibleName(/週間/);
    expect(ring()).toHaveTextContent("68%");
    await choose(await openMenu(), "外側のサービス", "Codex");
    expect(ring()).toHaveTextContent("80%");
    expect(find(await openMenu(), "表示枠", "週間").checked).toBe(true);
  });

  it("enters and leaves minimal mode and opens panels from minimal mode", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await choose(await openMenu(), "ミニマル化");
    expect(await screen.findByRole("button", { name: "通常モードに戻す" })).toBeInTheDocument();
    let items = await openMenu();
    expect(find(items, "通常モードに戻す")).toBeDefined();
    expect(find(items, "最前面に固定").checked).toBe(true);
    await choose(items, "通常モードに戻す");
    await waitFor(() => expect(screen.queryByRole("button", { name: "通常モードに戻す" })).toBeNull());

    await choose(await openMenu(), "ミニマル化");
    await screen.findByRole("button", { name: "通常モードに戻す" });
    items = await openMenu();
    await choose(items, "オプション");
    expect(await screen.findByRole("button", { name: "オプションを閉じる" })).toBeInTheDocument();
    expect(setSizeMock).toHaveBeenLastCalledWith(expect.objectContaining({ width: 400, height: 380 }));
    await choose(await openMenu(document.body), "取得状況");
    expect(await screen.findByRole("button", { name: "取得状況を閉じる" })).toBeInTheDocument();
  });

  it("toggles always-on-top independently and resets it when the mode changes", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await choose(await openMenu(), "最前面に固定");
    expect(setAlwaysOnTopMock).toHaveBeenLastCalledWith(true);
    expect(find(await openMenu(), "最前面に固定").checked).toBe(true);
    await choose(await openMenu(), "ミニマル化");
    await screen.findByRole("button", { name: "通常モードに戻す" });
    await choose(await openMenu(), "最前面に固定");
    expect(setAlwaysOnTopMock).toHaveBeenLastCalledWith(false);
    expect(find(await openMenu(), "最前面に固定").checked).toBe(false);
    expect(screen.getByRole("button", { name: "通常モードに戻す" })).toBeInTheDocument();
  });

  it("keeps the pin state when the native call fails", async () => {
    render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    setAlwaysOnTopMock.mockRejectedValueOnce(new Error("denied"));
    await choose(await openMenu(), "最前面に固定");
    expect(await screen.findByText(/denied/)).toBeInTheDocument();
    expect(find(await openMenu(), "最前面に固定").checked).toBe(false);
  });

  it("reloads, minimizes and closes the window", async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByRole("img", { name: /Claude Code 94%/ });
    await user.pointer({ target: ring(), keys: "[MouseRight]" });
    await waitFor(() => expect(menuNewMock).toHaveBeenCalled());
    const before = invokeMock.mock.calls.length;
    await choose(await openMenu(), "再読み込み");
    await waitFor(() => expect(invokeMock.mock.calls.length).toBeGreaterThan(before));
    await choose(await openMenu(), "最小化");
    expect(minimizeMock).toHaveBeenCalled();
    await choose(await openMenu(), "閉じる");
    expect(closeMock).toHaveBeenCalled();
    expect(menuCloseMock).toHaveBeenCalled();
  });
});
