import { load } from "@tauri-apps/plugin-store";
import { normalizeSettings } from "./providers";
import type { DisplaySettings } from "./types";

let storePromise: ReturnType<typeof load> | null = null;
function settingsStore() {
  if (!storePromise) storePromise = load("display-settings.json", { autoSave: false, defaults: {} }).catch((error: unknown) => {
    storePromise = null;
    throw error;
  });
  return storePromise;
}

export async function loadDisplaySettings(): Promise<DisplaySettings> {
  const store = await settingsStore();
  return normalizeSettings(await store.get<unknown>("display"));
}

export async function saveDisplaySettings(settings: DisplaySettings): Promise<void> {
  const store = await settingsStore();
  await store.set("display", normalizeSettings(settings));
  await store.save();
}
