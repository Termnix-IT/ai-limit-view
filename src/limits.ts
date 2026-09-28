import { formatDateTime } from "./date";
import type { LiveLimitWindow, LiveProviderLimits } from "./types";

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

export function providerStatus(provider: LiveProviderLimits | null): string {
  if (!provider) return "取得中";
  if (provider.status === "ok") return "取得済";
  switch (provider.errorCode) {
    case "auth_expired":
    case "auth_required": return "要認証";
    case "codex_not_found": return "CLI未検出";
    case "timeout": return "時間超過";
    default: return "取得失敗";
  }
}

export function limitTooltip(provider: LiveProviderLimits | null, window: LiveLimitWindow | null | undefined): string {
  if (!provider) return "残量を取得中です";
  if (!window) return provider.message ?? "この枠の残量は返っていません";
  return `${provider.source} · ${formatDateTime(provider.checkedAt)} · リセット ${formatResetAt(window.resetsAt)}`;
}
