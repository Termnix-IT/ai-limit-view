import { invoke } from "@tauri-apps/api/core";
import type { LiveLimits } from "./types";

export const api = {
  getLiveLimits() {
    return invoke<LiveLimits>("get_live_limits");
  },
};
