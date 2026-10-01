export type ToolKind = "codex" | "claude_code";
export type LimitProvider = ToolKind;
export type LimitScope = "fiveHour" | "weekly";

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
