import { invoke } from "@tauri-apps/api/core";
import type { AppUpdate, LimitProvider, LiveProviderLimits } from "./types";

export const api = {
  getProviderLimits(provider: LimitProvider) {
    return invoke<LiveProviderLimits>("get_provider_limits", { provider });
  },
  loadDisplaySettings() {
    return invoke<unknown>("load_display_settings");
  },
  saveDisplaySettings(settings: unknown) {
    return invoke<void>("save_display_settings", { settings });
  },
  checkAppUpdate() {
    return invoke<AppUpdate>("check_app_update");
  },
  installAppUpdate() {
    return invoke<void>("install_app_update");
  },
  appUpdateInstalling() {
    return invoke<boolean>("app_update_installing");
  },
  openReleasePage() {
    return invoke<void>("open_release_page");
  },
};
