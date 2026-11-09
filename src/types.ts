export type ToolKind = "codex" | "claude_code" | "zai" | "kimi_cli" | "command_code" | "opencode" | "antigravity" | "copilot" | "cursor";
export type LimitProvider = ToolKind;
export type LimitScope = "fiveHour" | "weekly" | "standard";

export interface SubscriptionWindow extends LiveLimitWindow {
  id: string;
  label: string;
  kind: "fiveHour" | "weekly" | "monthly" | "daily" | "other";
}

export interface DisplaySettings {
  version: 1;
  providers: ToolKind[];
  colors: Partial<Record<ToolKind, string>>;
  initialScope: LimitScope;
  /** Minimal-mode ring size, 1-100; 50 is the original size. */
  ringScale: number;
}

export interface LiveLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | number | null;
}

export interface LiveProviderLimits {
  status: "ok" | "unavailable";
  source: string;
  checkedAt: string;
  fiveHour: LiveLimitWindow | null;
  weekly: LiveLimitWindow | null;
  windows?: SubscriptionWindow[];
  message: string | null;
  errorCode: string | null;
  /** Time after which the provider's source data must not be shown, even as a cached value. */
  expiresAt?: string | null;
}

// Frontend state only; the Tauri response remains LiveProviderLimits.
export interface ProviderQuotaState extends LiveProviderLimits {
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
}

export type ProviderQuotaMap = Partial<Record<ToolKind, ProviderQuotaState | null>>;

export interface AppUpdate {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  checkedAt: string;
}
