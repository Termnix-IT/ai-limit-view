export type ToolKind = "codex" | "claude_code";
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
  codex: LiveProviderLimits;
  claude: LiveProviderLimits;
}
