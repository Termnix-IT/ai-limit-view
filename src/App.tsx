import {
  Activity,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  History,
  Link2,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { formatDateTime, formatMinutes, todayString, toDatetimeLocal } from "./date";
import type {
  AttentionLevel,
  Dashboard,
  SettingsView,
  SourceKind,
  ToolDashboard,
  ToolKind,
  UsageSession,
  UsageSessionInput,
} from "./types";

type Tab = "dashboard" | "logs" | "status" | "settings";

const toolLabels: Record<ToolKind, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
};

const sourceLabels: Record<SourceKind, string> = {
  manual: "Manual",
  status_paste: "Manual",
  log_import: "Estimated",
  estimated: "Estimated",
};

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [logs, setLogs] = useState<UsageSession[]>([]);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const date = useMemo(() => todayString(), []);

  const refresh = useCallback(async () => {
    const [dashboardResult, logsResult, settingsResult] = await Promise.all([
      api.getDashboard(date),
      api.listUsageLogs(),
      api.getSettings(),
    ]);
    setDashboard(dashboardResult);
    setLogs(logsResult);
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

  async function runAction(action: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(message);
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
              <Gauge size={18} />
              <span>AI LimitUsage Watcher</span>
            </div>
            <h1>{tabTitle(activeTab)}</h1>
            <p className="refreshLine">
              Auto refresh 5s / Process scan 30s
              {lastUpdatedAt ? ` / ${lastUpdatedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
            </p>
          </div>
          <button aria-label="Refresh" className="iconButton raised" onClick={() => void scanAndRefresh()} type="button">
            <Clock size={16} />
          </button>
        </header>

        <nav className="navList" aria-label="Primary navigation">
          <NavButton active={activeTab === "dashboard"} icon={<Activity />} label="Dashboard" onClick={() => setActiveTab("dashboard")} />
          <NavButton active={activeTab === "logs"} icon={<History />} label="Log" onClick={() => setActiveTab("logs")} />
          <NavButton active={activeTab === "status"} icon={<FileText />} label="Input" onClick={() => setActiveTab("status")} />
          <NavButton active={activeTab === "settings"} icon={<Settings />} label="Settings" onClick={() => setActiveTab("settings")} />
        </nav>

        {error ? <div className="alert danger">{error}</div> : null}
        {notice ? <div className="alert success">{notice}</div> : null}

        {activeTab === "dashboard" && <DashboardView dashboard={dashboard} settings={settings} onOpenOfficial={(tool) => runAction(() => api.openOfficialUsageUrl(tool), "公式Usageページを開きました。")} />}
        {activeTab === "logs" && <UsageLogView logs={logs} onCreate={(input) => runAction(() => api.createUsageSession(input), "使用ログを保存しました。")} onDelete={(id) => runAction(() => api.deleteUsageSession(id), "使用ログを削除しました。")} />}
        {activeTab === "status" && <StatusInputView onSaveStatus={(input) => runAction(() => api.saveStatusSnapshot(input), "ステータスを保存しました。")} onSaveManual={(input) => runAction(() => api.saveManualLimitEntry(input), "手動残量メモを保存しました。")} />}
        {activeTab === "settings" && settings ? <SettingsViewPanel settings={settings} onSave={(entries) => runAction(() => api.updateSettings(entries), "設定を保存しました。")} onOpenOfficial={(tool) => runAction(() => api.openOfficialUsageUrl(tool), "公式Usageページを開きました。")} /> : null}
      </section>
    </main>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }) {
  return (
    <button className={`navButton ${active ? "active" : ""}`} onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DashboardView({
  dashboard,
  settings,
  onOpenOfficial,
}: {
  dashboard: Dashboard | null;
  settings: SettingsView | null;
  onOpenOfficial: (tool: ToolKind) => void;
}) {
  if (!dashboard) return <EmptyState text="読み込み中です。" />;
  const highMinutes = Number(settings?.values.high_minutes ?? 240);

  return (
    <div className="stack">
      <div className="toolGrid">
        {dashboard.tools.map((tool) => (
          <ToolPanel key={`${tool.tool}-${tool.label}`} highMinutes={highMinutes} tool={tool} onOpenOfficial={onOpenOfficial} />
        ))}
      </div>
    </div>
  );
}

function ToolPanel({
  tool,
  highMinutes,
  onOpenOfficial,
}: {
  tool: ToolDashboard;
  highMinutes: number;
  onOpenOfficial: (tool: ToolKind) => void;
}) {
  const remainingPercent = estimatedRemainingPercent(tool.estimatedMinutesToday, highMinutes);
  const usedPercent = 100 - remainingPercent;

  return (
    <article className="toolPanel">
      <div className="toolPanelHeader">
        <div>
          <h2>{tool.label}</h2>
          <span>{tool.isRunning ? "起動中" : "停止中"}</span>
        </div>
        <span className={`sourcePill ${tool.isRunning ? "running" : ""}`}>{tool.isRunning ? "Running" : "Estimated"}</span>
      </div>

      <div className="usageGraph" aria-label={`${tool.label} 推定残り余力 ${remainingPercent}%`}>
        <div className="usageGraphTop">
          <span>推定残り余力</span>
          <strong>{remainingPercent}%</strong>
        </div>
        <div className="usageBar" aria-hidden="true">
          <div className="usageBarFill" style={{ width: `${remainingPercent}%` }} />
          <div className="usageBarUsed" style={{ width: `${usedPercent}%` }} />
        </div>
      </div>

      <div className="minimalStats">
        <span>今日 {formatMinutes(tool.estimatedMinutesToday)}</span>
        <span>最終 {formatDateTime(tool.lastUsedAt)}</span>
      </div>
      <button className="ghostButton fullWidth subtle" onClick={() => onOpenOfficial(tool.tool)} type="button">
        <ExternalLink size={16} />
        Official Usage
      </button>
    </article>
  );
}

function estimatedRemainingPercent(usedMinutes: number, highMinutes: number): number {
  const limit = Number.isFinite(highMinutes) && highMinutes > 0 ? highMinutes : 240;
  return Math.max(0, Math.min(100, Math.round(100 - (usedMinutes / limit) * 100)));
}

function Metric({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{source}</small>
    </div>
  );
}

function Fact({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <small>{source}</small>
    </div>
  );
}

function UsageLogView({ logs, onCreate, onDelete }: { logs: UsageSession[]; onCreate: (input: UsageSessionInput) => void; onDelete: (id: number) => void }) {
  const [tool, setTool] = useState<ToolKind>("codex");
  const [startedAt, setStartedAt] = useState(toDatetimeLocal());
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [note, setNote] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      tool,
      startedAt,
      endedAt: null,
      durationMinutes,
      source: "manual",
      confidence: 1,
      note: note || null,
    });
    setNote("");
  }

  return (
    <div className="splitLayout">
      <form className="entryPanel" onSubmit={submit}>
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Manual</p>
            <h2>使用ログを追加</h2>
          </div>
          <Plus size={18} />
        </div>
        <label>
          Tool
          <select value={tool} onChange={(event) => setTool(event.target.value as ToolKind)}>
            <option value="codex">Codex</option>
            <option value="claude_code">Claude Code</option>
          </select>
        </label>
        <label>
          Started
          <input value={startedAt} onChange={(event) => setStartedAt(event.target.value)} type="datetime-local" />
        </label>
        <label>
          Duration minutes
          <input min={0} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} type="number" />
        </label>
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
        </label>
        <button className="primaryButton" type="submit">
          <Save size={16} />
          Save Log
        </button>
      </form>
      <section className="sectionSurface">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Estimated</p>
            <h2>保存済みログ</h2>
          </div>
          <span>{logs.length}件</span>
        </div>
        <LogTable logs={logs} onDelete={onDelete} />
      </section>
    </div>
  );
}

function LogTable({ logs, compact = false, onDelete }: { logs: UsageSession[]; compact?: boolean; onDelete?: (id: number) => void }) {
  if (logs.length === 0) return <EmptyState text="まだ使用ログはありません。" />;

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Source</th>
            {!compact ? <th>Note</th> : null}
            {onDelete ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{toolLabels[log.tool]}</td>
              <td>{formatDateTime(log.startedAt)}</td>
              <td>{formatMinutes(log.durationMinutes)}</td>
              <td><span className="sourcePill">{sourceLabels[log.source]}</span></td>
              {!compact ? <td>{log.note || ""}</td> : null}
              {onDelete ? (
                <td>
                  <button className="iconButton" onClick={() => onDelete(log.id)} aria-label="Delete log" type="button">
                    <Trash2 size={16} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusInputView({
  onSaveStatus,
  onSaveManual,
}: {
  onSaveStatus: (input: { tool: ToolKind; capturedAt: string; rawText: string; summaryText: string | null }) => void;
  onSaveManual: (input: { tool: ToolKind; capturedAt: string; remainingLabel: string; resetAt: string | null; note: string | null; confidence: number }) => void;
}) {
  const [statusTool, setStatusTool] = useState<ToolKind>("codex");
  const [rawText, setRawText] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [manualTool, setManualTool] = useState<ToolKind>("claude_code");
  const [remainingLabel, setRemainingLabel] = useState("");
  const [manualNote, setManualNote] = useState("");

  function saveStatus(event: FormEvent) {
    event.preventDefault();
    onSaveStatus({
      tool: statusTool,
      capturedAt: toDatetimeLocal(),
      rawText,
      summaryText: summaryText || null,
    });
    setRawText("");
    setSummaryText("");
  }

  function saveManual(event: FormEvent) {
    event.preventDefault();
    onSaveManual({
      tool: manualTool,
      capturedAt: toDatetimeLocal(),
      remainingLabel,
      resetAt: null,
      note: manualNote || null,
      confidence: 0.7,
    });
    setRemainingLabel("");
    setManualNote("");
  }

  return (
    <div className="splitLayout">
      <form className="entryPanel" onSubmit={saveStatus}>
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Manual</p>
            <h2>/status 貼り付け</h2>
          </div>
          <FileText size={18} />
        </div>
        <label>
          Tool
          <select value={statusTool} onChange={(event) => setStatusTool(event.target.value as ToolKind)}>
            <option value="codex">Codex</option>
            <option value="claude_code">Claude Code</option>
          </select>
        </label>
        <label>
          Summary
          <input value={summaryText} onChange={(event) => setSummaryText(event.target.value)} placeholder="例: /status結果: 保存済み" />
        </label>
        <label>
          Raw text
          <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} rows={9} required />
        </label>
        <button className="primaryButton" type="submit">
          <Save size={16} />
          Save Status
        </button>
      </form>

      <form className="entryPanel" onSubmit={saveManual}>
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Manual</p>
            <h2>残量メモ</h2>
          </div>
          <Gauge size={18} />
        </div>
        <label>
          Tool
          <select value={manualTool} onChange={(event) => setManualTool(event.target.value as ToolKind)}>
            <option value="codex">Codex</option>
            <option value="claude_code">Claude Code</option>
          </select>
        </label>
        <label>
          Remaining label
          <input value={remainingLabel} onChange={(event) => setRemainingLabel(event.target.value)} placeholder="例: 約40% / リセットまで2時間" required />
        </label>
        <label>
          Note
          <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} rows={9} />
        </label>
        <button className="primaryButton" type="submit">
          <Save size={16} />
          Save Manual Note
        </button>
      </form>
    </div>
  );
}

function SettingsViewPanel({
  settings,
  onSave,
  onOpenOfficial,
}: {
  settings: SettingsView;
  onSave: (entries: Array<{ key: string; value: string }>) => void;
  onOpenOfficial: (tool: ToolKind) => void;
}) {
  const [values, setValues] = useState(settings.values);

  useEffect(() => {
    setValues(settings.values);
  }, [settings.values]);

  const updateValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(Object.entries(values).map(([key, value]) => ({ key, value })));
  }

  return (
    <div className="splitLayout">
      <form className="entryPanel" onSubmit={submit}>
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Estimated</p>
            <h2>注意レベル閾値</h2>
          </div>
          <Settings size={18} />
        </div>
        <label>
          Medium minutes
          <input value={values.medium_minutes ?? "120"} onChange={(event) => updateValue("medium_minutes", event.target.value)} type="number" min={0} />
        </label>
        <label>
          High minutes
          <input value={values.high_minutes ?? "240"} onChange={(event) => updateValue("high_minutes", event.target.value)} type="number" min={0} />
        </label>
        <label>
          Medium launches
          <input value={values.medium_launches ?? "5"} onChange={(event) => updateValue("medium_launches", event.target.value)} type="number" min={0} />
        </label>
        <label>
          High launches
          <input value={values.high_launches ?? "10"} onChange={(event) => updateValue("high_launches", event.target.value)} type="number" min={0} />
        </label>
        <label>
          Process monitor
          <select value={values.process_monitor_enabled ?? "1"} onChange={(event) => updateValue("process_monitor_enabled", event.target.value)}>
            <option value="1">Enabled</option>
            <option value="0">Disabled</option>
          </select>
        </label>
        <label>
          Codex process names
          <input value={values.codex_process_names ?? "codex.exe,codex"} onChange={(event) => updateValue("codex_process_names", event.target.value)} />
        </label>
        <label>
          Claude Code process names
          <input value={values.claude_code_process_names ?? "claude.exe,claude-code.exe,claude"} onChange={(event) => updateValue("claude_code_process_names", event.target.value)} />
        </label>
        <button className="primaryButton" type="submit">
          <Save size={16} />
          Save Settings
        </button>
      </form>
      <section className="sectionSurface">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Official / Local</p>
            <h2>保存場所と公式リンク</h2>
          </div>
          <Database size={18} />
        </div>
        <div className="factList spacious">
          <Fact label="SQLite database" value={settings.databasePath} source="Local" />
          <Fact label="OpenAI Usage" value={settings.officialUrls.codex} source="Official" />
          <Fact label="Claude Code Usage" value={settings.officialUrls.claude_code} source="Official" />
        </div>
        <div className="buttonRow">
          <button className="ghostButton" onClick={() => onOpenOfficial("codex")} type="button">
            <Link2 size={16} />
            OpenAI Usage
          </button>
          <button className="ghostButton" onClick={() => onOpenOfficial("claude_code")} type="button">
            <Link2 size={16} />
            Claude Usage
          </button>
        </div>
        <div className="policyBlock">
          <ShieldCheck size={18} />
          <p>このMVPはローカル保存だけを行い、認証情報・Cookie・ブラウザセッション・非公式Usage APIにはアクセスしません。</p>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="emptyState">{text}</div>;
}

function tabTitle(tab: Tab): string {
  switch (tab) {
    case "dashboard":
      return "Dashboard";
    case "logs":
      return "Usage Log";
    case "status":
      return "Status Input";
    case "settings":
      return "Settings";
  }
}
