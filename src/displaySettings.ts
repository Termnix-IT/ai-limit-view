import { api } from "./api";
import { normalizeSettings } from "./providers";
import type { DisplaySettings } from "./types";

// Persisted by fixed Rust commands in display-settings.json; the frontend has no
// generic file or Store access.
export async function loadDisplaySettings(): Promise<DisplaySettings> {
  return normalizeSettings(await api.loadDisplaySettings());
}

export async function saveDisplaySettings(settings: DisplaySettings): Promise<void> {
  await api.saveDisplaySettings(normalizeSettings(settings));
}
