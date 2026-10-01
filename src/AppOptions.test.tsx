import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppOptions } from "./AppOptions";
import { api } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import type { AppUpdate } from "./types";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("./api", () => ({ api: { checkAppUpdate: vi.fn(), openReleasePage: vi.fn() } }));

const checked: AppUpdate = { currentVersion: "0.1.12", latestVersion: "0.1.12", available: false, checkedAt: "2026-10-01T00:00:00Z" };

describe("AppOptions", () => {
  beforeEach(() => {
    vi.mocked(getVersion).mockReset().mockResolvedValue("0.1.12");
    vi.mocked(api.checkAppUpdate).mockReset().mockResolvedValue(checked);
    vi.mocked(api.openReleasePage).mockReset().mockResolvedValue(undefined);
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
    expect(screen.getByRole("status")).toHaveTextContent("公開版 v0.1.12 · 確認 2026-10-01 09:00");
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

  it("can recover version information through a successful update check", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("unavailable"));
    const user = userEvent.setup(); render(<AppOptions />);
    expect(await screen.findByText("取得できません")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更新を確認" }));
    expect(await screen.findByText("v0.1.12")).toBeInTheDocument();
  });
});
