import type { LimitProvider, LiveProviderLimits, ProviderQuotaState } from "./types";

export const REFRESH_INTERVAL = { codex: 60_000, claude_code: 300_000 } as const;
const MAX_RATE_LIMIT_DELAY = 30 * 60_000;
const TRANSIENT_ERRORS = new Set(["rate_limited", "server_error", "network_error", "api_error", "timeout", "fetch_failed"]);

export function refreshDelay(provider: LimitProvider, rateLimitFailures: number): number {
  const interval = REFRESH_INTERVAL[provider];
  return provider === "claude_code" && rateLimitFailures > 0
    ? Math.min(interval * 2 ** Math.min(rateLimitFailures - 1, 3), MAX_RATE_LIMIT_DELAY)
    : interval;
}

export function applyQuotaResult(
  previous: ProviderQuotaState | null, result: LiveProviderLimits, nextRetryAt: string | null,
): ProviderQuotaState {
  if (result.status === "ok") return { ...result, lastSuccessAt: result.checkedAt, nextRetryAt: null };
  const keepPrevious = previous?.lastSuccessAt != null && TRANSIENT_ERRORS.has(result.errorCode ?? "");
  return {
    ...result,
    fiveHour: keepPrevious ? previous.fiveHour : null,
    weekly: keepPrevious ? previous.weekly : null,
    lastSuccessAt: keepPrevious ? previous.lastSuccessAt : null,
    nextRetryAt,
  };
}

export function hasCachedQuota(provider: ProviderQuotaState | null): boolean {
  return provider?.status === "unavailable" && provider.lastSuccessAt != null;
}
