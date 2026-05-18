import { Gauge, Save, Settings } from "lucide-react";
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
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </p>
          </div>
          <button
            aria-label="設定"
            className={`iconButton raised ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings((current) => !current)}
            type="button"
          >
            <Settings size={16} />
          </button>
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
  const highMinutes = Number(settings?.values.high_minutes ?? 240);

  return (
    <div className="toolGrid">
      {dashboard.tools.map((tool) => (
        <ToolUsage key={`${tool.tool}-${tool.label}`} highMinutes={highMinutes} tool={tool} />
      ))}
    </div>
  );
}

function ToolUsage({ tool, highMinutes }: { tool: ToolDashboard; highMinutes: number }) {
  const remainingPercent = estimatedRemainingPercent(tool.estimatedMinutesToday, highMinutes);
  const usedPercent = 100 - remainingPercent;

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
    </section>
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
      <label>
        注意ライン 分
        <input
          min={0}
          type="number"
          value={values.medium_minutes ?? "120"}
          onChange={(event) => updateValue("medium_minutes", event.target.value)}
        />
      </label>
      <label>
        上限ライン 分
        <input
          min={0}
          type="number"
          value={values.high_minutes ?? "240"}
          onChange={(event) => updateValue("high_minutes", event.target.value)}
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
