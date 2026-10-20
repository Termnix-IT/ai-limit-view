import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, selectedWindow } from "./providers";
import { applyQuotaResult } from "./quotaRefresh";
import type { ProviderQuotaState } from "./types";

describe("display settings", () => {
  it("keeps the current two-provider default and repairs invalid stored preferences", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ version: 7, providers: ["zai"] })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ version: 1, providers: ["zai", "zai", "unknown", "codex", "kimi_cli", "opencode"],
      colors: { zai: "#ABCDEF", codex: "url(private)", unknown: "#ffffff" }, initialScope: "weekly" }))
      .toEqual({ version: 1, providers: ["zai", "codex", "kimi_cli"], colors: { zai: "#abcdef" }, initialScope: "weekly" });
    expect(normalizeSettings({ version: 1, providers: [] }).providers).toEqual(["codex", "claude_code"]);
  });

  it("does not substitute monthly subscription quota for a missing five-hour or weekly window", () => {
    const provider: ProviderQuotaState = { status: "ok", source: "OpenUsage", checkedAt: "2026-10-20T00:00:00Z",
      fiveHour: null, weekly: null, message: null, errorCode: null, lastSuccessAt: "2026-10-20T00:00:00Z", nextRetryAt: null,
      windows: [{ id: "usage_monthly", label: "月間", kind: "monthly", usedPercent: 20, remainingPercent: 80, resetsAt: null }] };
    expect(selectedWindow(provider, "fiveHour")).toBeNull();
    expect(selectedWindow(provider, "weekly")).toBeNull();
    expect(selectedWindow(provider, "standard")?.remainingPercent).toBe(80);
  });

  it("clears a previously valid quota when its statusline feed expires", () => {
    const result = { status: "ok" as const, source: "OpenUsage", checkedAt: "2026-10-20T00:00:00Z",
      fiveHour: null, weekly: null, message: null, errorCode: null,
      windows: [{ id: "model_quota", label: "モデル", kind: "other" as const, usedPercent: 20, remainingPercent: 80, resetsAt: null }] };
    const previous = applyQuotaResult(null, result, null);
    const expired = applyQuotaResult(previous, { ...result, status: "unavailable", windows: [], errorCode: "stale_data" }, null);
    expect(selectedWindow(expired, "standard")).toBeNull();
    expect(expired.lastSuccessAt).toBeNull();
  });
});
