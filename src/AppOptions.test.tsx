import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppOptions } from "./AppOptions";
import { api } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import { DEFAULT_SETTINGS } from "./providers";
import type { AppUpdate, DisplaySettings } from "./types";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("./api", () => ({ api: { checkAppUpdate: vi.fn(), installAppUpdate: vi.fn(), appUpdateInstalling: vi.fn(), openReleasePage: vi.fn() } }));

const checked: AppUpdate = { currentVersion: "0.1.12", latestVersion: null, available: false, checkedAt: "2026-10-01T00:00:00Z" };

describe("AppOptions", () => {
  beforeEach(() => {
    vi.mocked(getVersion).mockReset().mockResolvedValue("0.1.12");
    vi.mocked(api.checkAppUpdate).mockReset().mockResolvedValue(checked);
    vi.mocked(api.installAppUpdate).mockReset().mockResolvedValue(undefined);
    vi.mocked(api.appUpdateInstalling).mockReset().mockResolvedValue(false);
    vi.mocked(api.openReleasePage).mockReset().mockResolvedValue(undefined);
  });

  it("keeps blocking update actions when reopened during an install started earlier", async () => {
    vi.useFakeTimers();
    vi.mocked(api.appUpdateInstalling).mockResolvedValue(true);
    const view = render(<AppOptions />);
    try {
      await act(async () => {});
      expect(screen.getByRole("button", { name: "更新を確認" })).toBeDisabled();
      expect(screen.getByText(/自動で再起動します/)).toBeInTheDocument();
      vi.mocked(api.appUpdateInstalling).mockResolvedValue(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.getByRole("button", { name: "更新を確認" })).toBeEnabled();
      expect(screen.queryByText(/自動で再起動します/)).toBeNull();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it("displays the installed version without automatically checking releases", async () => {
    render(<AppOptions />);
    expect(await screen.findByText("v0.1.12")).toBeInTheDocument();
    expect(api.checkAppUpdate).not.toHaveBeenCalled();
    expect(api.openReleasePage).not.toHaveBeenCalled();
  });

  it("disables duplicate checks while pending and reports the checked release and timestamp", async () => {
    let resolve!: (result: AppUpdate) => void;
    vi.mocked(api.checkAppUpdate).mockReturnValue(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(); render(<AppOptions />);
    const button = screen.getByRole("button", { name: "更新を確認" });
    await user.click(button); await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(api.checkAppUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("取得しています");
    await act(async () => { resolve(checked); });
    expect(button).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("新しい更新はありません。");
    expect(screen.getByRole("status")).toHaveTextContent("確認 2026-10-01 09:00");
    expect(screen.queryByRole("button", { name: "更新してアプリを再起動" })).toBeNull();
  });

  it("installs only on request and blocks duplicates while installing", async () => {
    vi.mocked(api.checkAppUpdate).mockResolvedValue({ ...checked, latestVersion: "0.1.13", available: true });
    vi.mocked(api.installAppUpdate).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup(); render(<AppOptions />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    const install = await screen.findByRole("button", { name: "更新してアプリを再起動" });
    expect(api.installAppUpdate).not.toHaveBeenCalled();
    await user.click(install);
    const busy = screen.getByRole("button", { name: "更新中…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(api.installAppUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "更新を確認" })).toBeDisabled();
    expect(screen.getByText(/自動で再起動します/)).toBeInTheDocument();
  });

  it("shows a safe install failure and keeps retry and the release page available", async () => {
    vi.mocked(api.checkAppUpdate).mockResolvedValue({ ...checked, latestVersion: "0.1.13", available: true });
    vi.mocked(api.installAppUpdate).mockRejectedValueOnce(new Error("private-diagnostic"));
    const user = userEvent.setup(); render(<AppOptions />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    await user.click(await screen.findByRole("button", { name: "更新してアプリを再起動" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("更新をインストールできませんでした");
    expect(document.body).not.toHaveTextContent("private-diagnostic");
    expect(screen.getByRole("button", { name: "更新してアプリを再起動" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "配布ページを開く" })).toBeEnabled();
  });

  it("announces a newer version and opens the release page only on request", async () => {
    vi.mocked(api.checkAppUpdate).mockResolvedValue({ ...checked, latestVersion: "0.1.13", available: true });
    const user = userEvent.setup(); render(<AppOptions />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("v0.1.13 が公開されています。")).toBeInTheDocument();
    expect(api.openReleasePage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "配布ページを開く" }));
    expect(api.openReleasePage).toHaveBeenCalledTimes(1);
    expect(api.openReleasePage).toHaveBeenCalledWith();
  });

  it("shows a safe failure and clears it on retry without claiming success", async () => {
    vi.mocked(api.checkAppUpdate).mockRejectedValueOnce(new Error("private-diagnostic"));
    const user = userEvent.setup(); render(<AppOptions />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("更新情報を確認できませんでした");
    expect(document.body).not.toHaveTextContent("private-diagnostic");
    expect(screen.queryByText("新しい更新はありません。")).toBeNull();
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("新しい更新はありません。")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the classified backend error and allows the release page even if checking fails", async () => {
    vi.mocked(api.checkAppUpdate).mockRejectedValue("GitHub が更新確認を制限または拒否しています。時間をおいて再試行してください。");
    vi.mocked(api.openReleasePage).mockRejectedValue(new Error("private-browser-error"));
    const user = userEvent.setup(); render(<AppOptions />);
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub が更新確認を制限");
    await user.click(screen.getByRole("button", { name: "配布ページを開く" }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(document.body).not.toHaveTextContent("private-browser-error");
  });

  it.each([
    [["codex"], "1"],
    [["codex", "claude_code", "zai"], "3"],
  ] as const)("previews the minimal ring with %j at 100%% without live quotas", async (providers, count) => {
    const settings: DisplaySettings = { ...structuredClone(DEFAULT_SETTINGS), providers: [...providers], ringScale: 1 };
    const user = userEvent.setup();
    render(<AppOptions settings={settings} activeTool={providers[providers.length - 1]} scope="weekly" onSettingsChange={() => {}} />);
    await user.click(screen.getByRole("slider", { name: "ミニマル表示のリングサイズ" }));
    const preview = screen.getByTestId("ring-size-preview");
    const ring = preview.querySelector(".manaRing--minimal");
    expect(ring).toHaveAttribute("data-count", count);
    expect(ring?.getAttribute("style")).toContain("--minimal-zoom: 0.4");
    expect(preview.querySelectorAll(".manaRing__arc")).toHaveLength(providers.length);
    expect(preview.querySelectorAll(".manaRing__serviceButton")).toHaveLength(providers.length);
    expect(preview.querySelector(".manaRing__serviceButton[aria-pressed=\"true\"]")).toHaveAttribute("aria-label",
      expect.stringContaining(providers[providers.length - 1] === "zai" ? "Z.AI" : "Codex"));
    expect(preview.querySelector(".manaRing__scope")).toHaveTextContent("週間枠");
    expect(preview).toHaveTextContent("実寸 72px");
    // The copy is display-only: it is hidden from assistive technology and cannot take focus or clicks.
    expect(screen.queryByRole("button", { name: /を外側に表示/ })).toBeNull();
    expect((preview as HTMLElement & { inert?: boolean }).inert).toBe(true);
  });

  it("keeps each service's standard window label in the 100% preview", async () => {
    const settings: DisplaySettings = { ...structuredClone(DEFAULT_SETTINGS), providers: ["kimi_cli", "codex"] };
    const monthly = { id: "monthly", label: "月間", kind: "monthly" as const, usedPercent: 70, remainingPercent: 30, resetsAt: null };
    const limits = { kimi_cli: { status: "ok" as const, source: "OpenUsage", checkedAt: "", fiveHour: null, weekly: null, windows: [monthly],
      message: null, errorCode: null, lastSuccessAt: null, nextRetryAt: null } };
    const user = userEvent.setup();
    render(<AppOptions settings={settings} limits={limits} activeTool="kimi_cli" scope="standard" onSettingsChange={() => {}} />);
    await user.click(screen.getByRole("slider", { name: "ミニマル表示のリングサイズ" }));
    const preview = screen.getByTestId("ring-size-preview");
    expect(preview.querySelector(".manaRing__scope")).toHaveTextContent("月間枠");
    expect(preview.querySelector(".manaRing__value")).toHaveTextContent("100%");
    // Codex has no live data yet; its standard ring is still drawn at 100%.
    expect(preview.querySelector("svg")).toHaveAccessibleName(/Kimi Code 100%、Codex 100%/);
  });

  it("draws every ring at 100% even if a service lacks the selected window", async () => {
    const settings: DisplaySettings = { ...structuredClone(DEFAULT_SETTINGS), providers: ["kimi_cli", "codex"] };
    const monthly = { id: "monthly", label: "月間", kind: "monthly" as const, usedPercent: 70, remainingPercent: 30, resetsAt: null };
    const limits = { kimi_cli: { status: "ok" as const, source: "OpenUsage", checkedAt: "", fiveHour: null, weekly: null, windows: [monthly],
      message: null, errorCode: null, lastSuccessAt: null, nextRetryAt: null } };
    const user = userEvent.setup();
    render(<AppOptions settings={settings} limits={limits} activeTool="kimi_cli" scope="fiveHour" onSettingsChange={() => {}} />);
    await user.click(screen.getByRole("slider", { name: "ミニマル表示のリングサイズ" }));
    const preview = screen.getByTestId("ring-size-preview");
    expect(preview.querySelectorAll(".manaRing__arc")).toHaveLength(2);
    expect(preview.querySelector(".manaRing__scope")).toHaveTextContent("5時間枠");
  });

  it("can recover version information through a successful update check", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("unavailable"));
    const user = userEvent.setup(); render(<AppOptions />);
    expect(await screen.findByText("取得できません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("v0.1.12")).toBeInTheDocument();
  });
});
