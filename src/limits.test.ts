import { describe, expect, it } from "vitest";
import { formatResetAt, formatResetCountdown } from "./limits";

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
});
