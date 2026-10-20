import type { CSSProperties } from "react";
import type { DisplaySettings, LimitScope, ProviderQuotaState, SubscriptionWindow, ToolKind } from "./types";

export const PROVIDERS = {
  codex: { label: "Codex", shortLabel: "Codex", mark: "", start: "#268cdf", color: "#70d5ff", note: "Codex CLIのログインを使用", conditional: false },
  claude_code: { label: "Claude Code", shortLabel: "Claude Code", mark: "", start: "#ff902f", color: "#ffcd76", note: "Claude Codeのログインを使用", conditional: false },
  zai: { label: "Z.AI Coding Plan", shortLabel: "Z.AI", mark: "Z", start: "#49ad7b", color: "#9ce6be", note: "OpenUsageに設定したCoding PlanのAPIキーを使用", conditional: false },
  kimi_cli: { label: "Kimi Code", shortLabel: "Kimi Code", mark: "K", start: "#32a6b7", color: "#8ee7e2", note: "Kimi Code CLIのログインを使用。5時間・月間枠に対応", conditional: false },
  command_code: { label: "Command Code", shortLabel: "Command", mark: ">", start: "#9e73db", color: "#d3b5ff", note: "Command CodeのログインまたはAPIキーを使用", conditional: false },
  opencode: { label: "OpenCode Go", shortLabel: "OpenCode", mark: "O", start: "#df71a7", color: "#ffb2d9", note: "OpenUsageでコンソールのログイン連携が必要です", conditional: false },
  antigravity: { label: "Antigravity CLI", shortLabel: "Antigravity", mark: "A", start: "#7b8ae8", color: "#b9c5ff", note: "条件付き：OpenUsageのstatusline連携が必要。モデル枠のうち最少の残量を表示。5分以上古い情報は更新待ち", conditional: true },
  copilot: { label: "GitHub Copilot", shortLabel: "Copilot", mark: "G", start: "#7295be", color: "#c1dcfa", note: "条件付き：gh auth loginが必要。旧Premium Request枠を対象に取得。新AI Credits方式は未確認", conditional: true },
  cursor: { label: "Cursor", shortLabel: "Cursor", mark: "C", start: "#a2a9b4", color: "#e1e8f1", note: "条件付き：Cursorのログインを使用。新しい契約体系の取得は未確認", conditional: true },
} as const;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ToolKind[];
export const DEFAULT_SETTINGS: DisplaySettings = { version: 1, providers: ["codex", "claude_code"], colors: {}, initialScope: "fiveHour" };

export function normalizeSettings(value: unknown): DisplaySettings {
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1) return structuredClone(DEFAULT_SETTINGS);
  const row = value as Partial<Record<keyof DisplaySettings, unknown>>;
  const providers = Array.isArray(row.providers) ? [...new Set(row.providers.filter((id): id is ToolKind => typeof id === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, id)))].slice(0, 3) : [];
  const colors: DisplaySettings["colors"] = {};
  if (typeof row.colors === "object" && row.colors !== null) {
    for (const id of PROVIDER_IDS) {
      const color: unknown = Reflect.get(row.colors, id);
      if (typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) colors[id] = color.toLowerCase();
    }
  }
  return { version: 1, providers: providers.length ? providers : [...DEFAULT_SETTINGS.providers], colors,
    initialScope: row.initialScope === "weekly" || row.initialScope === "standard" ? row.initialScope : "fiveHour" };
}

export function providerVariant(id: ToolKind): string { return id === "claude_code" ? "claude" : id; }

export function providerStyle(id: ToolKind, color?: string): CSSProperties {
  const preset = PROVIDERS[id];
  const end = color ?? preset.color;
  const rgb = [1, 3, 5].map((offset) => parseInt(end.slice(offset, offset + 2), 16));
  const start = color ? `rgb(${rgb.map((v) => Math.round(v * 0.7)).join(", ")})` : preset.start;
  const originalVariant = id === "codex" ? "codex" : id === "claude_code" ? "claude" : null;
  return { "--ring-start": start, "--ring-end": end, "--service-color": end,
    "--service-soft": !color && originalVariant ? `var(--${originalVariant}-soft)` : `rgba(${rgb.join(", ")}, 0.2)`,
    "--service-glow": !color && originalVariant ? `var(--${originalVariant}-glow)` : `rgba(${rgb.join(", ")}, 0.36)` } as CSSProperties;
}

export function providerWindows(provider: ProviderQuotaState | null | undefined): SubscriptionWindow[] {
  if (provider?.windows?.length) return provider.windows;
  const windows: (SubscriptionWindow | null)[] = [
    provider?.fiveHour ? { ...provider.fiveHour, id: "fiveHour", label: "5時間", kind: "fiveHour" as const } : null,
    provider?.weekly ? { ...provider.weekly, id: "weekly", label: "週間", kind: "weekly" as const } : null,
  ];
  return windows.filter((entry): entry is SubscriptionWindow => entry !== null);
}

export function selectedWindow(provider: ProviderQuotaState | null | undefined, scope: LimitScope): SubscriptionWindow | null {
  const windows = providerWindows(provider);
  return scope === "standard" ? windows[0] ?? null : windows.find((entry) => entry.kind === scope) ?? null;
}

export function scopeLabel(scope: LimitScope): string { return scope === "fiveHour" ? "5時間" : scope === "weekly" ? "週間" : "サービス標準"; }
