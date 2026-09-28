import { invoke } from "@tauri-apps/api/core";
import type { LimitProvider, LiveProviderLimits } from "./types";

export const api = {
  getProviderLimits(provider: LimitProvider) {
    return invoke<LiveProviderLimits>("get_provider_limits", { provider });
  },
};
