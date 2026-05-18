import { Gauge, RefreshCw, Save, Settings } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatDateTime, todayString } from "./date";
import { ManaRing } from "./ManaRing";
import { ToolChipRail } from "./ToolChipRail";
import type { Dashboard, SettingsView, ToolDashboard } from "./types";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const date = useMemo(() => todayString(), []);

  const refresh = useCallback(async () => {
    const [dashboardResult, settingsResult] = await Promise.all([
      api.getDashboard(date),
      api.getSettings(),
    ]);
    setDashboard(dashboardResult);
    setSettings(settingsResult);
    setLastUpdatedAt(new Date());
  }, [date]);

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

  async function saveSettings(entries: Array<{ key: string; value: string }>) {
    setError(null);
    setNotice(null);
    try {
      await api.updateSettings(entries);
      await refresh();
      setNotice("設定を保存しました。");
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <main className="appShell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="brandMark">
              <Gauge size={12} />
              <span>AI LimitUsage Watcher</span>
            </div>
            <h1>{showSettings ? "設定" : "MANA STATUS"}</h1>
            <p className="refreshLine">
              auto-sync
              {lastUpdatedAt
                ? ` · ${lastUpdatedAt.toLocaleTimeString("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </p>
          </div>
          <div className="topbarActions">
            <button
              aria-label="再読み込み"
              className="iconButton"
              onClick={() => {
                scanAndRefresh().catch((err) => setError(String(err)));
              }}
              type="button"
            >
              <RefreshCw size={14} />
            </button>
            <button
              aria-label="設定"
              className={`iconButton ${showSettings ? "active" : ""}`}
              onClick={() => setShowSettings((current) => !current)}
              type="button"
            >
              <Settings size={14} />
            </button>
          </div>
        </header>

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        {showSettings && settings ? (
          <SettingsPanel settings={settings} onSave={saveSettings} />
        ) : (
          <DashboardView dashboard={dashboard} settings={settings} now={now} />
        )}
      </section>
    </main>
  );
}

function DashboardView({
  dashboard,
  settings,
  now,
}: {
  dashboard: Dashboard | null;
  settings: SettingsView | null;
  now: Date;
}) {
  if (!dashboard) return <EmptyState text="読み込み中です…" />;

  const codex = dashboard.tools.find((t) => t.tool === "codex");
  const claude = dashboard.tools.find((t) => t.tool === "claude_code");

  const codexPct = codex
    ? estimatedRemainingPercent(
        codex.estimatedMinutesWindow,
        toolHourHighMinutes(codex, settings),
      )
    : 100;
  const claudePct = claude
    ? quotaRemainingPercent(claude.quotaSessionUsed ?? 0, claude.quotaSessionLimit ?? 0)
    : 100;

  return (
    <>
      <div className="manaPanel">
        <ManaRing codexRemainingPercent={codexPct} claudeRemainingPercent={claudePct} />
      </div>
      <div className="chipGrid">
        {codex ? <CodexChipRail tool={codex} settings={settings} now={now} /> : null}
        {claude ? <ClaudeChipRail tool={claude} now={now} /> : null}
      </div>
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
  const rechargeMinutes = computeCodexRecharge(tool, windowMinutes);
  const recharge = rechargeMinutes > 0 ? formatCountdown(rechargeMinutes * 60) : "—";
  const sinceLast = relativeTime(tool.lastUsedAt, now);
  const intensity: "calm" | "steady" | "hot" =
    paceMinutesPerHour > 30 ? "hot" : paceMinutesPerHour > 10 ? "steady" : "calm";

  return (
    <ToolChipRail
      variant="codex"
      tool={tool}
      tierLabel="Pro"
      output={{
        value: `${paceMinutesPerHour.toFixed(1)} 分/h`,
        tooltip: `直近${windowMinutes}分の累計 ${used} 分 (上限 ${limit} 分)`,
        intensity,
      }}
      recharge={{
        value: recharge,
        tooltip: `時間枠 ${windowMinutes} 分のうち残り ${remaining} 分`,
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
  const remainingTokens = Math.max(0, limit - used);
  const rechargeAt = tool.quotaSessionResetAt;
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
        value: `${formatTokens(Math.round(burn))} tok/分`,
        tooltip: `5h枠 ${formatTokens(used)} / ${formatTokens(limit)} (残 ${formatTokens(remainingTokens)})`,
        intensity,
      }}
      recharge={{
        value: recharge,
        tooltip: tool.quotaProjectedDepletionAt
          ? `マナ枯渇予測 ${formatDateTime(tool.quotaProjectedDepletionAt)}`
          : rechargeAt
            ? `次のリチャージ ${formatDateTime(rechargeAt)}`
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

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: SettingsView;
  onSave: (entries: Array<{ key: string; value: string }>) => void;
}) {
  const [values, setValues] = useState(settings.values);

  useEffect(() => {
    setValues(settings.values);
  }, [settings.values]);

  const updateValue = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(Object.entries(values).map(([key, value]) => ({ key, value })));
  }

  return (
    <form className="settingsPanel" onSubmit={submit}>
      <section className="settingSection codex">
        <div className="settingSection__title">Codex 設定</div>
        <label>
          Codex 注意ライン 分
          <input
            min={0}
            type="number"
            value={values.codex_medium_minutes ?? values.medium_minutes ?? "120"}
            onChange={(event) => updateValue("codex_medium_minutes", event.target.value)}
          />
        </label>
        <label>
          Codex 上限ライン 分
          <input
            min={0}
            type="number"
            value={values.codex_high_minutes ?? values.high_minutes ?? "240"}
            onChange={(event) => updateValue("codex_high_minutes", event.target.value)}
          />
        </label>
        <label>
          Codex 時間枠 分
          <input
            min={1}
            type="number"
            value={values.codex_hour_window_minutes ?? "300"}
            onChange={(event) => updateValue("codex_hour_window_minutes", event.target.value)}
          />
        </label>
        <label>
          Codex 時間上限 分
          <input
            min={0}
            type="number"
            value={values.codex_hour_high_minutes ?? "60"}
            onChange={(event) => updateValue("codex_hour_high_minutes", event.target.value)}
          />
        </label>
        <label>
          Codex 監視名
          <input
            value={values.codex_process_names ?? "codex.exe,codex"}
            onChange={(event) => updateValue("codex_process_names", event.target.value)}
          />
        </label>
      </section>

      <section className="settingSection claude">
        <div className="settingSection__title">Claude Code 設定</div>
        <label>
          Claude Code プラン
          <select
            value={values.claude_code_plan ?? "pro"}
            onChange={(event) => updateValue("claude_code_plan", event.target.value)}
          >
            <option value="pro">Pro</option>
            <option value="max5">Max 5x</option>
            <option value="max20">Max 20x</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {(values.claude_code_plan ?? "pro") === "custom" ? (
          <label>
            Claude Code 5時間枠トークン上限 (Custom)
            <input
              min={1}
              type="number"
              value={values.claude_code_session_token_limit ?? "70000000"}
              onChange={(event) =>
                updateValue("claude_code_session_token_limit", event.target.value)
              }
            />
          </label>
        ) : null}
        <label>
          Claude Code 5時間枠 分
          <input
            min={1}
            type="number"
            value={values.claude_code_session_window_minutes ?? "300"}
            onChange={(event) =>
              updateValue("claude_code_session_window_minutes", event.target.value)
            }
          />
        </label>
        <label>
          Claude Code バーンレート計測窓 分
          <input
            min={1}
            type="number"
            value={values.claude_code_burn_window_minutes ?? "30"}
            onChange={(event) =>
              updateValue("claude_code_burn_window_minutes", event.target.value)
            }
          />
        </label>
        <label>
          Claude Code 監視名
          <input
            value={values.claude_code_process_names ?? "claude.exe,claude-code.exe,claude"}
            onChange={(event) => updateValue("claude_code_process_names", event.target.value)}
          />
        </label>
      </section>

      <section className="settingSection shared">
        <div className="settingSection__title">監視設定</div>
        <label>
          プロセス監視
          <select
            value={values.process_monitor_enabled ?? "1"}
            onChange={(event) => updateValue("process_monitor_enabled", event.target.value)}
          >
            <option value="1">有効</option>
            <option value="0">無効</option>
          </select>
        </label>
      </section>

      <button className="primaryButton" type="submit">
        <Save size={14} />
        設定を保存
      </button>
      <p className="storagePath">保存先: {settings.databasePath}</p>
    </form>
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

function computeCodexRecharge(tool: ToolDashboard, windowMinutes: number): number {
  if (!tool.activeSessionStartedAt) return 0;
  const started = new Date(tool.activeSessionStartedAt).getTime();
  if (Number.isNaN(started)) return 0;
  const end = started + windowMinutes * 60_000;
  const remainingMs = end - Date.now();
  return remainingMs > 0 ? Math.floor(remainingMs / 60_000) : 0;
}
