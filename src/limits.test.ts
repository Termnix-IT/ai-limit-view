import { describe, expect, it } from "vitest";
import { formatResetAt, formatResetCountdown, providerStatus } from "./limits";
import { applyQuotaResult } from "./quotaRefresh";

describe("service reset times", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  it("accepts both Codex Unix timestamps and Claude ISO timestamps", () => {
    const reset = "2026-09-28T04:15:00Z";
    expect(formatResetAt(Date.parse(reset) / 1000)).toBe("2026-09-28 13:15");
    expect(formatResetCountdown(reset, now)).toBe("4時間15分");
    expect(formatResetCountdown(Date.parse(reset) / 1000, now)).toBe("4時間15分");
    expect(formatResetCountdown("2026-09-30T05:00:00Z", now)).toBe("2日5時間");
  });
  it("does not invent reset times for missing or invalid service data", () => {
    expect(formatResetCountdown(null, now)).toBe("—");
    expect(formatResetCountdown("invalid", now)).toBe("—");
    expect(formatResetAt(undefined)).toBe("—");
  });
  it("waits for a service update after reset instead of calculating negative time", () => {
    expect(formatResetCountdown("2026-09-27T23:00:00Z", now)).toBe("更新待ち");
    expect(formatResetCountdown("2026-09-28T00:00:20Z", now)).toBe("1分");
  });
  it("classifies authentication recovery failures and clears cached quotas", () => {
    const previous = applyQuotaResult(null, {
      status: "ok", source: "OpenUsage", checkedAt: now.toISOString(),
      fiveHour: { usedPercent: 20, remainingPercent: 80, resetsAt: null },
      weekly: null, message: null, errorCode: null,
    }, null);
    for (const [errorCode, label] of [
      ["auth_refresh_cli_missing", "CLI未検出"],
      ["auth_refresh_timeout", "時間超過"],
      ["auth_refresh_start_failed", "要認証"],
      ["auth_refresh_failed", "要認証"],
    ]) {
      const result = applyQuotaResult(previous, {
        status: "unavailable", source: "OpenUsage", checkedAt: now.toISOString(),
        fiveHour: null, weekly: null, message: "認証更新に失敗しました", errorCode,
      }, null);
      expect(providerStatus(result)).toBe(label);
      expect(result.fiveHour).toBeNull();
      expect(result.lastSuccessAt).toBeNull();
    }
  });
});
