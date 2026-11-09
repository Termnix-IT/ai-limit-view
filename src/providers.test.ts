import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, selectedWindow } from "./providers";
import { applyQuotaResult } from "./quotaRefresh";
import { minimalRingPx, minimalRingZoom, minimalWindowPx } from "./ringSize";
import type { ProviderQuotaState } from "./types";

describe("display settings", () => {
  it("keeps the current two-provider default and repairs invalid stored preferences", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ version: 7, providers: ["zai"] })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ version: 1, providers: ["zai", "zai", "unknown", "codex", "kimi_cli", "opencode"],
      colors: { zai: "#ABCDEF", codex: "url(private)", unknown: "#ffffff" }, initialScope: "weekly" }))
      .toEqual({ version: 1, providers: ["zai", "codex", "kimi_cli"], colors: { zai: "#abcdef" }, initialScope: "weekly", ringScale: 50 });
    expect(normalizeSettings({ version: 1, providers: [] }).providers).toEqual(["codex", "claude_code"]);
  });

  it("keeps the minimal ring size within 1-100 and the original size at 50", () => {
    expect([0, 1, 37.6, 100, 250, "80", Number.NaN, undefined].map((ringScale) => normalizeSettings({ version: 1, ringScale }).ringScale))
      .toEqual([1, 1, 38, 100, 100, 50, 50, 50]);
    expect([50, 100, 25].map((scale) => [minimalRingPx(scale), minimalWindowPx(scale)])).toEqual([[180, 200], [360, 400], [90, 100]]);
    // Smaller settings stop at a 72px ring so the readout and buttons stay usable.
    expect([20, 1].map((scale) => [minimalRingZoom(scale), minimalRingPx(scale), minimalWindowPx(scale)])).toEqual([[0.4, 72, 80], [0.4, 72, 80]]);
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
