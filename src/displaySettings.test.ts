import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { DEFAULT_SETTINGS } from "./providers";

vi.mock("./api", () => ({ api: { loadDisplaySettings: vi.fn(), saveDisplaySettings: vi.fn() } }));
// The shared setup replaces this module for App tests; exercise the real one here.
const { loadDisplaySettings, saveDisplaySettings } = await vi.importActual<typeof import("./displaySettings")>("./displaySettings");

describe("displaySettings", () => {
  beforeEach(() => {
    vi.mocked(api.loadDisplaySettings).mockReset();
    vi.mocked(api.saveDisplaySettings).mockReset().mockResolvedValue(undefined);
  });

  it("normalizes what the fixed backend command returns", async () => {
    vi.mocked(api.loadDisplaySettings).mockResolvedValue(null);
    expect(await loadDisplaySettings()).toEqual(DEFAULT_SETTINGS);
    vi.mocked(api.loadDisplaySettings).mockResolvedValue({ version: 1, providers: ["cursor", "unknown"], colors: { cursor: "#ABCDEF", codex: "red" }, initialScope: "weekly", ringScale: 500 });
    expect(await loadDisplaySettings()).toEqual({ version: 1, providers: ["cursor"], colors: { cursor: "#abcdef" }, initialScope: "weekly", ringScale: 100 });
  });

  it("saves only normalized settings through the backend command", async () => {
    await saveDisplaySettings({ ...DEFAULT_SETTINGS, ringScale: 0 });
    expect(api.saveDisplaySettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, ringScale: 1 });
  });
});
