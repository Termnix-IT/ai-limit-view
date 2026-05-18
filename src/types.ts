export type ToolKind = "codex" | "claude_code";
export type SourceKind = "manual" | "status_paste" | "log_import" | "estimated";
export type AttentionLevel = "low" | "medium" | "high";

export interface UsageSessionInput {
  tool: ToolKind;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes: number;
  source: SourceKind;
  confidence: number;
  note?: string | null;
}

export interface StatusSnapshotInput {
  tool: ToolKind;
  capturedAt: string;
  rawText: string;
  summaryText?: string | null;
}

export interface ManualLimitEntryInput {
  tool: ToolKind;
  capturedAt: string;
  remainingLabel: string;
  resetAt?: string | null;
  note?: string | null;
  confidence: number;
}

export interface UsageSession {
  id: number;
  tool: ToolKind;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes: number;
  source: SourceKind;
  confidence: number;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDashboard {
  tool: ToolKind;
  label: string;
  launchCountToday: number;
  estimatedMinutesToday: number;
  estimatedMinutesWindow: number;
  windowMinutes: number;
  lastUsedAt?: string | null;
  latestStatusSummary?: string | null;
  statusSaved: boolean;
  latestManualRemaining?: string | null;
  attentionLevel: AttentionLevel;
  officialUsageUrl: string;
  isRunning: boolean;
  activeSessionStartedAt?: string | null;
  quotaSessionUsed?: number | null;
  quotaSessionLimit?: number | null;
  quotaSessionResetAt?: string | null;
  quotaSessionWindowMinutes?: number | null;
  quotaSessionStartedAt?: string | null;
  quotaBurnRateTokensPerMin?: number | null;
  quotaProjectedDepletionAt?: string | null;
  quotaPlan?: string | null;
}

export interface Dashboard {
  date: string;
  tools: ToolDashboard[];
  recentLogs: UsageSession[];
}

export interface SettingsView {
  values: Record<string, string>;
  databasePath: string;
  officialUrls: Record<ToolKind, string>;
}
