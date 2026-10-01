import { invoke } from "@tauri-apps/api/core";
import type { AppUpdate, LimitProvider, LiveProviderLimits } from "./types";

export const api = {
  getProviderLimits(provider: LimitProvider) {
    return invoke<LiveProviderLimits>("get_provider_limits", { provider });
  },
  checkAppUpdate() {
    return invoke<AppUpdate>("check_app_update");
  },
  openReleasePage() {
    return invoke<void>("open_release_page");
  },
};
