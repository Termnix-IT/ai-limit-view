import { Gauge, RefreshCw, Save, Settings } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatDateTime, formatMinutes, todayString } from "./date";
import type { Dashboard, SettingsView, ToolDashboard } from "./types";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
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
              <Gauge size={16} />
              <span>AI LimitUsage Watcher</span>
            </div>
            <h1>{showSettings ? "設定" : "使用状況"}</h1>
            <p className="refreshLine">
              自動更新中
              {lastUpdatedAt
                ? ` / ${lastUpdatedAt.toLocaleTimeString("ja-JP", {
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
              className="iconButton raised"
              onClick={() => {
                scanAndRefresh().catch((err) => setError(String(err)));
              }}
              type="button"
            >
              <RefreshCw size={16} />
            </button>
            <button
              aria-label="設定"
              className={`iconButton raised ${showSettings ? "active" : ""}`}
              onClick={() => setShowSettings((current) => !current)}
              type="button"
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        {showSettings && settings ? (
          <SettingsPanel settings={settings} onSave={saveSettings} />
        ) : (
          <DashboardView dashboard={dashboard} settings={settings} />
        )}
      </section>
    </main>
  );
}

function DashboardView({
  dashboard,
  settings,
}: {
  dashboard: Dashboard | null;
  settings: SettingsView | null;
}) {
  if (!dashboard) return <EmptyState text="読み込み中です。" />;

  return (
    <div className="toolGrid">
      {dashboard.tools.map((tool) =>
        tool.tool === "claude_code" ? (
          <ClaudeCodeQuotaUsage key={`${tool.tool}-${tool.label}`} tool={tool} />
        ) : (
          <ToolUsage
            key={`${tool.tool}-${tool.label}`}
            highMinutes={toolHighMinutes(tool, settings)}
            hourHighMinutes={toolHourHighMinutes(tool, settings)}
            tool={tool}
          />
        ),
      )}
    </div>
  );
}

function ToolUsage({
  tool,
  highMinutes,
  hourHighMinutes,
}: {
  tool: ToolDashboard;
  highMinutes: number;
  hourHighMinutes: number;
}) {
  const remainingPercent = estimatedRemainingPercent(tool.estimatedMinutesToday, highMinutes);
  const hourRemainingPercent = estimatedRemainingPercent(tool.estimatedMinutesWindow, hourHighMinutes);
  const usedPercent = 100 - remainingPercent;
  const hourUsedPercent = 100 - hourRemainingPercent;

  return (
    <section className="toolUsage" aria-label={`${tool.label} 推定残り余力 ${remainingPercent}%`}>
      <div className="toolUsageHeader">
        <div>
          <h2>{tool.label}</h2>
          <span>{tool.isRunning ? "起動中" : "停止中"}</span>
        </div>
        <strong>{remainingPercent}%</strong>
      </div>

      <div className="usageBar" aria-hidden="true">
        <div className="usageBarFill" style={{ width: `${remainingPercent}%` }} />
        <div className="usageBarUsed" style={{ width: `${usedPercent}%` }} />
      </div>

      <div className="minimalStats">
        <span>今日の使用 {formatMinutes(tool.estimatedMinutesToday)}</span>
        <span>最終使用 {formatDateTime(tool.lastUsedAt)}</span>
      </div>
      <div className="hourLimit">
        <div className="hourLimitLabel">
          <span>時間枠 {formatMinutes(tool.estimatedMinutesWindow)}</span>
          <strong>{hourRemainingPercent}%</strong>
        </div>
        <div className="usageBar small" aria-hidden="true">
          <div className="usageBarFill" style={{ width: `${hourRemainingPercent}%` }} />
          <div className="usageBarUsed" style={{ width: `${hourUsedPercent}%` }} />
        </div>
      </div>
    </section>
  );
}

function ClaudeCodeQuotaUsage({ tool }: { tool: ToolDashboard }) {
  const sessionUsed = tool.quotaSessionUsed ?? 0;
  const sessionLimit = tool.quotaSessionLimit ?? 0;
  const sessionRemainingPercent = quotaRemainingPercent(sessionUsed, sessionLimit);
  const sessionUsedPercent = 100 - sessionRemainingPercent;
  const burnRate = tool.quotaBurnRateTokensPerMin ?? 0;
  const planLabel = formatPlanLabel(tool.quotaPlan);

  return (
    <section
      className="toolUsage"
      aria-label={`${tool.label} 5時間枠残り ${sessionRemainingPercent}%`}
    >
      <div className="toolUsageHeader">
        <div>
          <h2>{tool.label}</h2>
          <span>{planLabel} / {tool.isRunning ? "起動中" : "停止中"}</span>
        </div>
        <strong>{sessionRemainingPercent}%</strong>
      </div>

      <div className="usageBar" aria-hidden="true">
        <div className="usageBarFill" style={{ width: `${sessionRemainingPercent}%` }} />
        <div className="usageBarUsed" style={{ width: `${sessionUsedPercent}%` }} />
      </div>

      <div className="minimalStats">
        <span>
          CLI 5時間枠 {formatTokens(sessionUsed)} / {formatTokens(sessionLimit)}
        </span>
        <span>最終使用 {formatDateTime(tool.lastUsedAt)}</span>
      </div>

      <div className="hourLimit">
        <div className="hourLimitLabel">
          <span>バーンレート {formatTokens(Math.round(burnRate))} tok/分</span>
          <span>
            {tool.quotaSessionResetAt
              ? `リセット ${formatDateTime(tool.quotaSessionResetAt)}`
              : "アクティブな5時間枠なし"}
          </span>
        </div>
        <div className="minimalStats">
          <span>
            {tool.quotaProjectedDepletionAt
              ? `枯渇予測 ${formatDateTime(tool.quotaProjectedDepletionAt)}`
              : burnRate > 0
                ? "リセットまでに余裕あり"
                : "—"}
          </span>
        </div>
      </div>
    </section>
  );
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
            onChange={(event) => updateValue("claude_code_session_token_limit", event.target.value)}
          />
        </label>
      ) : null}
      <label>
        Claude Code 5時間枠 分
        <input
          min={1}
          type="number"
          value={values.claude_code_session_window_minutes ?? "300"}
          onChange={(event) => updateValue("claude_code_session_window_minutes", event.target.value)}
        />
      </label>
      <label>
        Claude Code バーンレート計測窓 分
        <input
          min={1}
          type="number"
          value={values.claude_code_burn_window_minutes ?? "30"}
          onChange={(event) => updateValue("claude_code_burn_window_minutes", event.target.value)}
        />
      </label>
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
      <label>
        Codex 監視名
        <input
          value={values.codex_process_names ?? "codex.exe,codex"}
          onChange={(event) => updateValue("codex_process_names", event.target.value)}
        />
      </label>
      <label>
        Claude Code 監視名
        <input
          value={values.claude_code_process_names ?? "claude.exe,claude-code.exe,claude"}
          onChange={(event) => updateValue("claude_code_process_names", event.target.value)}
        />
      </label>
      <button className="primaryButton" type="submit">
        <Save size={15} />
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

function toolHighMinutes(tool: ToolDashboard, settings: SettingsView | null): number {
  const fallback = Number(settings?.values.high_minutes ?? 240);
  const specific = Number(settings?.values[`${tool.tool}_high_minutes`] ?? fallback);
  return Number.isFinite(specific) && specific > 0 ? specific : fallback;
}

function toolHourHighMinutes(tool: ToolDashboard, settings: SettingsView | null): number {
  const specific = Number(settings?.values[`${tool.tool}_hour_high_minutes`] ?? 60);
  return Number.isFinite(specific) && specific > 0 ? specific : 60;
}
