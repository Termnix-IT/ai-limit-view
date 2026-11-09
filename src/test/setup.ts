import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { settingsStore } from "./settingsStore";

vi.mock("../displaySettings", async () => {
  const { normalizeSettings } = await import("../providers");
  return {
    loadDisplaySettings: async () => normalizeSettings(settingsStore.get()),
    saveDisplaySettings: async (settings: unknown) => { settingsStore.set(normalizeSettings(settings)); },
  };
});
beforeEach(() => settingsStore.clear());
