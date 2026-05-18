import { invoke } from "@tauri-apps/api/core";
import type {
  Dashboard,
  ManualLimitEntryInput,
  SettingsView,
  StatusSnapshotInput,
  ToolKind,
  UsageSession,
  UsageSessionInput,
} from "./types";

export const api = {
  getDashboard(date: string) {
    return invoke<Dashboard>("get_dashboard", { date });
  },
  listUsageLogs() {
    return invoke<UsageSession[]>("list_usage_logs", { filter: null });
  },
  createUsageSession(input: UsageSessionInput) {
    return invoke<number>("create_usage_session", { input });
  },
  updateUsageSession(id: number, input: UsageSessionInput) {
    return invoke<void>("update_usage_session", { id, input });
  },
  deleteUsageSession(id: number) {
    return invoke<void>("delete_usage_session", { id });
  },
  saveStatusSnapshot(input: StatusSnapshotInput) {
    return invoke<number>("save_status_snapshot", { input });
  },
  saveManualLimitEntry(input: ManualLimitEntryInput) {
    return invoke<number>("save_manual_limit_entry", { input });
  },
  getSettings() {
    return invoke<SettingsView>("get_settings");
  },
  updateSettings(entries: Array<{ key: string; value: string }>) {
    return invoke<void>("update_settings", { entries });
  },
  openOfficialUsageUrl(tool: ToolKind) {
    return invoke<void>("open_official_usage_url", { tool });
  },
};
