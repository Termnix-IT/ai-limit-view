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
}

export interface LiveLimits {
  codex: LiveProviderLimits | null;
  claude: LiveProviderLimits | null;
}

// Frontend state only; the Tauri response remains LiveProviderLimits.
export interface ProviderQuotaState extends LiveProviderLimits {
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
}

export interface LiveQuotaState {
  codex: ProviderQuotaState | null;
  claude: ProviderQuotaState | null;
}

export type ProviderQuotaMap = Partial<Record<ToolKind, ProviderQuotaState | null>>;

export interface AppUpdate {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  checkedAt: string;
}
