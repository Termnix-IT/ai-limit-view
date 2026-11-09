import { describe, expect, it } from "vitest";
import { applyQuotaResult, withoutExpiredQuota } from "./quotaRefresh";
import type { LiveProviderLimits, ProviderQuotaState } from "./types";

const window = { id: "model_quota", label: "モデル", kind: "other" as const, usedPercent: 28, remainingPercent: 72, resetsAt: null };
const ok: LiveProviderLimits = { status: "ok", source: "OpenUsage", checkedAt: "2026-11-10T00:00:00Z", fiveHour: null, weekly: null,
  windows: [window], message: null, errorCode: null, expiresAt: "2026-11-10T00:05:00Z" };
const timeout: LiveProviderLimits = { ...ok, status: "unavailable", checkedAt: "2026-11-10T00:01:00Z", windows: [], message: "timeout", errorCode: "timeout", expiresAt: null };
const at = (time: string) => Date.parse(time);

describe("quota expiry", () => {
  it("keeps cached values through a transient error only until the source data expires", () => {
    const fresh = applyQuotaResult(null, ok, null);
    expect(applyQuotaResult(fresh, timeout, null, at("2026-11-10T00:04:59Z")).windows).toEqual([window]);
    const expired = applyQuotaResult(fresh, timeout, null, at("2026-11-10T00:05:00Z"));
    expect(expired.windows).toEqual([]);
    expect(expired.lastSuccessAt).toBeNull();
  });

  it("hides expired values even without a new retrieval result", () => {
    const fresh: ProviderQuotaState = applyQuotaResult(null, ok, null);
    expect(withoutExpiredQuota(fresh, at("2026-11-10T00:04:59Z"))).toBe(fresh);
    const hidden = withoutExpiredQuota(fresh, at("2026-11-10T00:05:00Z"));
    expect(hidden).toMatchObject({ status: "unavailable", errorCode: "stale_data", windows: [], lastSuccessAt: null });
  });

  it("never expires providers without a source expiry", () => {
    const codex = applyQuotaResult(null, { ...ok, expiresAt: undefined }, null);
    expect(withoutExpiredQuota(codex, at("2030-01-01T00:00:00Z"))).toBe(codex);
    expect(applyQuotaResult(codex, timeout, null, at("2030-01-01T00:00:00Z")).windows).toEqual([window]);
  });
});
