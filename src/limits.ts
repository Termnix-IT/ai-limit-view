import { formatDateTime } from "./date";
import { hasCachedQuota } from "./quotaRefresh";
import type { LiveLimitWindow, ProviderQuotaState } from "./types";

export function formatRemaining(limit: LiveLimitWindow | null | undefined): string {
  return limit ? `${limit.remainingPercent}%` : "—";
}

export function resetDate(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatResetAt(value: string | number | null | undefined): string {
  const date = resetDate(value);
  return date ? formatDateTime(date.toISOString()) : "—";
}

export function formatResetCountdown(value: string | number | null | undefined, now: Date): string {
  const date = resetDate(value);
  if (!date) return "—";
  const remaining = date.getTime() - now.getTime();
  if (remaining <= 0) return "更新待ち";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間${minutes % 60}分`;
  return `${Math.floor(hours / 24)}日${hours % 24}時間`;
}

export function providerStatus(provider: ProviderQuotaState | null): string {
  if (!provider) return "取得中";
  if (provider.status === "ok") return "取得済";
  if (hasCachedQuota(provider)) return "更新失敗";
  switch (provider.errorCode) {
    case "auth_expired":
    case "auth_required": return "要認証";
    case "auth_rejected": return "認証拒否";
    case "rate_limited": return "取得制限";
    case "server_error": return "サーバー障害";
    case "network_error": return "通信失敗";
    case "codex_not_found": return "CLI未検出";
    case "timeout": return "時間超過";
    default: return "取得失敗";
  }
}

export function providerDetails(provider: ProviderQuotaState | null): string {
  if (!provider) return "残量を取得中です";
  return [
    provider.message,
    hasCachedQuota(provider) && provider.lastSuccessAt ? `前回の取得値 · 最終取得 ${formatDateTime(provider.lastSuccessAt)}` : null,
    provider.nextRetryAt ? `次回再試行 ${formatDateTime(provider.nextRetryAt)}` : null,
  ].filter(Boolean).join(" · ") || provider.source;
}

export function limitTooltip(provider: ProviderQuotaState | null, window: LiveLimitWindow | null | undefined): string {
  if (!provider) return "残量を取得中です";
  if (!window) return provider.status === "unavailable" ? providerDetails(provider) : "この枠の残量は返っていません";
  if (hasCachedQuota(provider)) return `${providerDetails(provider)} · リセット ${formatResetAt(window.resetsAt)}`;
  return `${provider.source} · ${formatDateTime(provider.lastSuccessAt ?? provider.checkedAt)} · リセット ${formatResetAt(window.resetsAt)}`;
}
