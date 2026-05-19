import { useCallback, useEffect, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { formatDateTime, todayString } from "./date";
import { ManaRing } from "./ManaRing";
import { Titlebar } from "./Titlebar";
import { ToolChipRail } from "./ToolChipRail";
import type { Dashboard, LimitScope, ManualLimitSummary, SettingsView, ToolDashboard } from "./types";

const PLAN_CYCLE = ["pro", "max5", "max20"] as const;

const NORMAL_SIZE: [number, number] = [400, 380];
const MINIMAL_SIZE: [number, number] = [200, 200];

export function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [minimal, setMinimal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeRingTool, setActiveRingTool] = useState<ToolDashboard["tool"]>("claude_code");

  const refresh = useCallback(async () => {
    const date = todayString();
    const [dashboardResult, settingsResult] = await Promise.all([
      api.getDashboard(date),
      api.getSettings(),
    ]);
    setDashboard(dashboardResult);
    setSettings(settingsResult);
    setLastUpdatedAt(new Date());
  }, []);

  const scanAndRefresh = useCallback(async () => {
    await api.scanProcessUsage();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    scanAndRefresh().catch((err) => setError(String(err)));
  }, [scanAndRefresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch((err) => setError(String(err)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      scanAndRefresh().catch((err) => setError(String(err)));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [scanAndRefresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const enterMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(MINIMAL_SIZE[0], MINIMAL_SIZE[1]));
      await win.setAlwaysOnTop(true);
      setMinimal(true);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const exitMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(false);
      await win.setSize(new LogicalSize(NORMAL_SIZE[0], NORMAL_SIZE[1]));
      setMinimal(false);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const cyclePlan = useCallback(async () => {
    const claude = dashboard?.tools.find((t) => t.tool === "claude_code");
    const current = (claude?.quotaPlan ?? "pro").toLowerCase();
    const index = PLAN_CYCLE.indexOf(current as (typeof PLAN_CYCLE)[number]);
    const next = PLAN_CYCLE[(index < 0 ? 0 : index + 1) % PLAN_CYCLE.length];
    try {
      await api.updateSettings([{ key: "claude_code_plan", value: next }]);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }, [dashboard, refresh]);

  const saveManualLimit = useCallback(
    async ({
      tool,
      scope,
      remainingPercent,
      resetAt,
    }: {
      tool: ToolDashboard["tool"];
      scope: LimitScope;
      remainingPercent: number;
      resetAt?: string | null;
    }) => {
      await api.saveManualLimitEntry({
        tool,
        capturedAt: new Date().toISOString(),
        scope,
        remainingLabel: `${Math.round(remainingPercent)}%`,
        remainingPercent,
        resetAt: resetAt || null,
        note: scope === "session_5h" ? "Manual 5h session remaining" : "Manual remaining",
        confidence: 1,
      });
      await refresh();
    },
    [refresh],
  );

  const syncedAt = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <main className={`appShell${minimal ? " appShell--minimal" : ""}`}>
      {minimal ? null : (
        <Titlebar
          syncedAt={syncedAt}
          onReload={() => {
            scanAndRefresh().catch((err) => setError(String(err)));
          }}
          onSettings={() => setSettingsOpen((open) => !open)}
          settingsOpen={settingsOpen}
          onMinimal={() => {
            void enterMinimal();
          }}
        />
      )}
      <section className="workspace">
        {error && !minimal ? <div className="alert danger">{error}</div> : null}

        <DashboardView
          dashboard={dashboard}
          settings={settings}
          now={now}
          activeRingTool={activeRingTool}
          onSwitchRingTool={setActiveRingTool}
          onCyclePlan={cyclePlan}
          minimal={minimal}
          settingsOpen={settingsOpen}
          onExitMinimal={() => {
            void exitMinimal();
          }}
          onSaveManualLimit={(input) => {
            saveManualLimit(input).catch((err) => setError(String(err)));
          }}
        />
      </section>
    </main>
  );
}

function DashboardView({
  dashboard,
  settings,
  now,
  activeRingTool,
  onSwitchRingTool,
  onCyclePlan,
  minimal,
  settingsOpen,
  onExitMinimal,
  onSaveManualLimit,
}: {
  dashboard: Dashboard | null;
  settings: SettingsView | null;
  now: Date;
  activeRingTool: ToolDashboard["tool"];
  onSwitchRingTool: (tool: ToolDashboard["tool"]) => void;
  onCyclePlan: () => void;
  minimal: boolean;
  settingsOpen: boolean;
  onExitMinimal: () => void;
  onSaveManualLimit: (input: {
    tool: ToolDashboard["tool"];
    scope: LimitScope;
    remainingPercent: number;
    resetAt?: string | null;
  }) => void;
}) {
  if (!dashboard) return <EmptyState text="読み込み中です…" />;

  const codex = dashboard.tools.find((t) => t.tool === "codex");
  const claude = dashboard.tools.find((t) => t.tool === "claude_code");

  const codexSession = codex ? manualLimit(codex, "session_5h") : null;
  const claudeSession = claude ? manualLimit(claude, "session_5h") : null;
  const codexPct = codexSession?.remainingPercent ?? (codex
    ? estimatedRemainingPercent(
        codex.estimatedMinutesWindow,
        toolHourHighMinutes(codex, settings),
      )
    : 100);
  const claudePct = claudeSession?.remainingPercent ?? (claude
    ? quotaRemainingPercent(claude.quotaSessionUsed ?? 0, claude.quotaSessionLimit ?? 0)
    : 100);
  const planLabel = formatPlanLabel(claude?.quotaPlan ?? "pro");

  return (
    <>
      {settingsOpen && !minimal ? null : (
        <div className="manaPanel">
          <ManaRing
            codexRemainingPercent={codexPct}
            claudeRemainingPercent={claudePct}
            activeTool={activeRingTool}
            planLabel={planLabel}
            onCyclePlan={onCyclePlan}
            onSwitchTool={onSwitchRingTool}
            minimal={minimal}
            onExitMinimal={onExitMinimal}
          />
        </div>
      )}
      {minimal || settingsOpen ? null : (
        <div className="chipGrid">
          {codex ? <CodexChipRail tool={codex} settings={settings} now={now} /> : null}
          {claude ? <ClaudeChipRail tool={claude} now={now} /> : null}
        </div>
      )}
      {minimal || !settingsOpen ? null : (
        <div className="manualGrid">
          {codex ? (
            <>
              <ManualLimitEditor
                tool={codex}
                scope="session_5h"
                label="Codex 5h"
                limit={manualLimit(codex, "session_5h")}
                now={now}
                onSave={onSaveManualLimit}
              />
              <ManualLimitEditor
                tool={codex}
                scope="weekly"
                label="Codex Week"
                limit={manualLimit(codex, "weekly")}
                now={now}
                onSave={onSaveManualLimit}
              />
            </>
          ) : null}
          {claude ? (
            <>
              <ManualLimitEditor
                tool={claude}
                scope="session_5h"
                label="Claude 5h"
                limit={manualLimit(claude, "session_5h")}
                fallbackResetAt={claude.estimatedSessionResetAt}
                now={now}
                onSave={onSaveManualLimit}
              />
              <ManualLimitEditor
                tool={claude}
                scope="weekly"
                label="Claude Week"
                limit={manualLimit(claude, "weekly")}
                now={now}
                onSave={onSaveManualLimit}
              />
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

function CodexChipRail({
  tool,
  settings,
  now,
}: {
  tool: ToolDashboard;
  settings: SettingsView | null;
  now: Date;
}) {
  const windowMinutes = tool.windowMinutes || 300;
  const hourHigh = toolHourHighMinutes(tool, settings);
  const used = tool.estimatedMinutesWindow;
  const limit = hourHigh;
  // Output: 「窓内で何分使ったか」を 1 時間あたりに正規化したものをペースとして表示。
  const paceMinutesPerHour = windowMinutes > 0 ? (used / windowMinutes) * 60 : 0;
  const remaining = Math.max(0, limit - used);
  const remainingLabel = `${remaining}分`;
  const sinceLast = relativeTime(tool.lastUsedAt, now);
  const intensity: "calm" | "steady" | "hot" =
    paceMinutesPerHour > 30 ? "hot" : paceMinutesPerHour > 10 ? "steady" : "calm";
  const sessionLimit = manualLimit(tool, "session_5h");
  const weeklyLimit = manualLimit(tool, "weekly");

  return (
    <ToolChipRail
      variant="codex"
      tool={tool}
      tierLabel="Pro"
      output={{
        label: "5h残",
        value: sessionLimit?.remainingLabel ?? `${estimatedRemainingPercent(used, limit)}%`,
        tooltip: sessionLimit
          ? `手入力 ${formatDateTime(sessionLimit.capturedAt)}`
          : `推定: 直近${windowMinutes}分の累計 ${used} 分 (上限 ${limit} 分)`,
        intensity,
      }}
      recharge={{
        label: weeklyLimit ? "週残" : "枠残り",
        value: weeklyLimit?.remainingLabel ?? remainingLabel,
        tooltip: weeklyLimit
          ? `週制限の手入力 ${formatDateTime(weeklyLimit.capturedAt)}`
          : `時間枠 ${windowMinutes} 分のうち残り ${remaining} 分`,
        warn: remaining > 0 && remaining <= 5,
      }}
      status={{
        value: sinceLast,
        tooltip: tool.isRunning ? "Codex プロセスは稼働中" : "Codex プロセスは待機中",
        running: tool.isRunning,
      }}
    />
  );
}

function ClaudeChipRail({ tool, now }: { tool: ToolDashboard; now: Date }) {
  const used = tool.quotaSessionUsed ?? 0;
  const limit = tool.quotaSessionLimit ?? 0;
  const burn = tool.quotaBurnRateTokensPerMin ?? 0;
  const tierLabel = formatPlanLabel(tool.quotaPlan);
  const sessionLimit = manualLimit(tool, "session_5h");
  const weeklyLimit = manualLimit(tool, "weekly");
  const remainingTokens = Math.max(0, limit - used);
  const rechargeAt = sessionLimit?.resetAt ?? tool.estimatedSessionResetAt ?? tool.quotaSessionResetAt;
  const rechargeSeconds = rechargeAt ? secondsUntil(rechargeAt, now) : 0;
  const recharge = rechargeAt && rechargeSeconds > 0 ? formatCountdown(rechargeSeconds) : "—";
  const sinceLast = relativeTime(tool.lastUsedAt, now);
  const intensity: "calm" | "steady" | "hot" =
    burn > 500_000 ? "hot" : burn > 100_000 ? "steady" : "calm";
  const depletionWarn = !!tool.quotaProjectedDepletionAt && rechargeSeconds > 0;

  return (
    <ToolChipRail
      variant="claude"
      tool={tool}
      tierLabel={tierLabel}
      output={{
        label: "5h残",
        value: sessionLimit?.remainingLabel ?? `${quotaRemainingPercent(used, limit)}%`,
        tooltip: sessionLimit
          ? `手入力 ${formatDateTime(sessionLimit.capturedAt)}`
          : `推定: 5h枠 ${formatTokens(used)} / ${formatTokens(limit)} (残 ${formatTokens(remainingTokens)})`,
        intensity,
      }}
      recharge={{
        label: weeklyLimit ? "週残" : "リチャージ",
        value: weeklyLimit?.remainingLabel ?? recharge,
        tooltip: tool.quotaProjectedDepletionAt
          ? `マナ枯渇予測 ${formatDateTime(tool.quotaProjectedDepletionAt)}`
          : weeklyLimit
            ? `週制限の手入力 ${formatDateTime(weeklyLimit.capturedAt)}`
            : rechargeAt
              ? `${sessionLimit?.resetAt ? "手入力リセット" : "推定リセット"} ${formatDateTime(rechargeAt)}`
            : "アクティブな5時間枠なし",
        warn: depletionWarn,
      }}
      status={{
        value: sinceLast,
        tooltip: tool.isRunning ? "Claude Code セッション稼働中" : "Claude Code 待機中",
        running: tool.isRunning,
      }}
    />
  );
}

function ManualLimitEditor({
  tool,
  scope,
  label,
  limit,
  fallbackResetAt,
  now,
  onSave,
}: {
  tool: ToolDashboard;
  scope: LimitScope;
  label: string;
  limit: ManualLimitSummary | null;
  fallbackResetAt?: string | null;
  now: Date;
  onSave: (input: {
    tool: ToolDashboard["tool"];
    scope: LimitScope;
    remainingPercent: number;
    resetAt?: string | null;
  }) => void;
}) {
  const [percent, setPercent] = useState(() => limit?.remainingPercent?.toString() ?? "");
  const [resetAt, setResetAt] = useState(() => toDatetimeLocalValue(limit?.resetAt ?? fallbackResetAt));
  const needsReset = scope !== "manual";

  useEffect(() => {
    setPercent(limit?.remainingPercent?.toString() ?? "");
    setResetAt(toDatetimeLocalValue(limit?.resetAt ?? fallbackResetAt));
  }, [fallbackResetAt, limit?.remainingPercent, limit?.resetAt]);

  const parsedPercent = Number(percent);
  const canSave = Number.isFinite(parsedPercent) && parsedPercent >= 0 && parsedPercent <= 100;
  const age = limit ? relativeTime(limit.capturedAt, now) : "未記録";
  const resetValue = limit?.resetAt ?? fallbackResetAt;
  const resetLabel = needsReset && resetValue ? formatDateTime(resetValue) : null;

  return (
    <section className="manualLimit" aria-label={`${label} 手入力残量`}>
      <div className="manualLimit__head">
        <strong>{label}</strong>
        <span>{age}</span>
      </div>
      <div className="manualLimit__row">
        <input
          aria-label={`${label} 残り%`}
          inputMode="decimal"
          min="0"
          max="100"
          type="number"
          value={percent}
          onChange={(event) => setPercent(event.target.value)}
          placeholder="残り%"
        />
        {needsReset ? (
          <input
            aria-label={`${label} リセット時刻`}
            type="datetime-local"
            value={resetAt}
            onChange={(event) => setResetAt(event.target.value)}
          />
        ) : null}
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave({
              tool: tool.tool,
              scope,
              remainingPercent: Math.round(parsedPercent),
              resetAt: resetAt ? new Date(resetAt).toISOString() : null,
            })
          }
        >
          保存
        </button>
      </div>
      {resetLabel ? <div className="manualLimit__hint">終了 {resetLabel}</div> : null}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="emptyState">{text}</div>;
}

function estimatedRemainingPercent(usedMinutes: number, highMinutes: number): number {
  const limit = Number.isFinite(highMinutes) && highMinutes > 0 ? highMinutes : 240;
  return Math.max(0, Math.min(100, Math.round(100 - (usedMinutes / limit) * 100)));
}

function quotaRemainingPercent(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (used / limit) * 100)));
}

function manualLimit(tool: ToolDashboard, scope: LimitScope): ManualLimitSummary | null {
  return tool.manualLimits.find((limit) => limit.scope === scope) ?? null;
}

function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.round(tokens)}`;
}

function toolHourHighMinutes(tool: ToolDashboard, settings: SettingsView | null): number {
  const specific = Number(settings?.values[`${tool.tool}_hour_high_minutes`] ?? 60);
  return Number.isFinite(specific) && specific > 0 ? specific : 60;
}

function formatPlanLabel(plan?: string | null): string {
  switch ((plan ?? "").toLowerCase()) {
    case "pro":
      return "Pro";
    case "max5":
    case "max_5":
    case "max-5":
      return "Max 5x";
    case "max20":
    case "max_20":
    case "max-20":
      return "Max 20x";
    case "custom":
      return "Custom";
    default:
      return plan ?? "—";
  }
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function secondsUntil(iso: string, now: Date): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.floor((target - now.getTime()) / 1000));
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function relativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return "未記録";
  const past = new Date(iso).getTime();
  if (Number.isNaN(past)) return "未記録";
  const diffSec = Math.max(0, Math.floor((now.getTime() - past) / 1000));
  if (diffSec < 60) return `${diffSec}秒前`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  return `${day}日前`;
}
