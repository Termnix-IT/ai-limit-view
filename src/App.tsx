import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { LimitsSettings } from "./LimitsSettings";
import { AppOptions } from "./AppOptions";
import { ManaRing } from "./ManaRing";
import { Titlebar } from "./Titlebar";
import { ToolChipRail } from "./ToolChipRail";
import { limitTooltip } from "./limits";
import { applyQuotaResult, hasCachedQuota, refreshDelay } from "./quotaRefresh";
import { DEFAULT_SETTINGS, PROVIDER_IDS, normalizeSettings, selectedWindow } from "./providers";
import { loadDisplaySettings, saveDisplaySettings } from "./displaySettings";
import type { DisplaySettings, LimitProvider, LimitScope, LiveProviderLimits, ProviderQuotaMap, ToolKind } from "./types";

const NORMAL_SIZE: [number, number] = [400, 380];
const MINIMAL_SIZE: [number, number] = [200, 200];

export function App() {
  const [settings, setSettings] = useState<DisplaySettings>(() => structuredClone(DEFAULT_SETTINGS));
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const [liveLimits, setLiveLimits] = useState<ProviderQuotaMap>({});
  const liveRefreshRunning = useRef<Partial<Record<ToolKind, boolean>>>({});
  const schedule = useRef(Object.fromEntries(PROVIDER_IDS.map((id) => [id, { nextAt: 0, cooldownUntil: 0, rateLimitFailures: 0 }])) as Record<ToolKind, { nextAt: number; cooldownUntil: number; rateLimitFailures: number }>);
  const mounted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [minimal, setMinimal] = useState(false);
  const [panel, setPanel] = useState<"limits" | "options" | null>(null);
  const [activeRingTool, setActiveRingTool] = useState<ToolKind>("claude_code");
  const [scope, setScope] = useState<LimitScope>("fiveHour");

  useEffect(() => {
    let active = true;
    void loadDisplaySettings().then((saved) => {
      if (!active) return;
      setSettings(saved); setScope(saved.initialScope);
      setActiveRingTool(saved.providers.includes("claude_code") ? "claude_code" : saved.providers[0]);
    }).catch(() => {
      if (active) setSettingsError("表示設定を読み込めませんでした。初期設定で表示しています。変更すると保存を再試行します。");
    }).finally(() => { if (active) setSettingsLoaded(true); });
    return () => { active = false; };
  }, []);

  function changeSettings(value: DisplaySettings) {
    const next = normalizeSettings(value);
    if (next.initialScope !== settings.initialScope) setScope(next.initialScope);
    setSettings(next);
    setActiveRingTool((current) => next.providers.includes(current) ? current : next.providers[0]);
    setSaving(true); setSettingsError(null);
    const revision = ++saveRevision.current;
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveDisplaySettings(next));
    void saveQueue.current.then(() => {
      if (mounted.current && revision === saveRevision.current) setSaving(false);
    }).catch(() => {
      if (mounted.current && revision === saveRevision.current) {
        setSaving(false); setSettingsError("表示設定を保存できませんでした。今回の変更は再起動後に保持されません。設定を変更して再試行してください。");
      }
    });
  }

  const refreshProvider = useCallback(async (provider: LimitProvider, manual: boolean) => {
    const timing = schedule.current[provider];
    if (liveRefreshRunning.current[provider] || Date.now() < timing.cooldownUntil
      || (!manual && Date.now() < timing.nextAt)) return;
    liveRefreshRunning.current[provider] = true;
    setRefreshing(true);
    let result: LiveProviderLimits;
    try { result = await api.getProviderLimits(provider); }
    catch {
      result = { status: "unavailable", source: provider === "codex" ? "Codex app-server" : "OpenUsage",
        checkedAt: new Date().toISOString(), fiveHour: null, weekly: null, windows: [],
        message: "残量の取得処理に失敗しました。再読み込みしてください。", errorCode: "fetch_failed" };
    }
    const rateLimited = result.status === "unavailable" && result.errorCode === "rate_limited";
    timing.rateLimitFailures = rateLimited ? timing.rateLimitFailures + 1 : 0;
    timing.nextAt = Date.now() + refreshDelay(provider, timing.rateLimitFailures);
    timing.cooldownUntil = rateLimited ? timing.nextAt : 0;
    liveRefreshRunning.current[provider] = false;
    if (!mounted.current) return;
    const nextRetryAt = result.status === "unavailable" ? new Date(timing.nextAt).toISOString() : null;
    setLiveLimits((current) => ({ ...current, [provider]: applyQuotaResult(current[provider] ?? null, result, nextRetryAt) }));
    setRefreshing(Object.values(liveRefreshRunning.current).some(Boolean));
  }, []);

  const refreshLiveLimits = useCallback((manual = false) => {
    if (!settingsLoaded) return;
    for (const provider of settings.providers) void refreshProvider(provider, manual);
  }, [refreshProvider, settings.providers, settingsLoaded]);

  useEffect(() => {
    mounted.current = true;
    refreshLiveLimits();
    const timer = window.setInterval(() => { setNow(new Date()); refreshLiveLimits(); }, 1000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refreshLiveLimits]);

  const enterMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setShadow(false);
      await win.setSize(new LogicalSize(MINIMAL_SIZE[0], MINIMAL_SIZE[1]));
      await win.setAlwaysOnTop(true);
      setPanel(null); setMinimal(true); setError(null);
    } catch (err) { setError(String(err)); }
  }, []);
  const exitMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(false);
      await win.setShadow(true);
      await win.setSize(new LogicalSize(NORMAL_SIZE[0], NORMAL_SIZE[1]));
      setMinimal(false); setError(null);
    } catch (err) { setError(String(err)); }
  }, []);

  const selectedProvider = liveLimits[activeRingTool] ?? null;
  const staleMessage = hasCachedQuota(selectedProvider) ? limitTooltip(selectedProvider, selectedWindow(selectedProvider, scope)) : null;
  const lastCheckedAt = settings.providers.map((id) => liveLimits[id]?.lastSuccessAt)
    .filter((value): value is string => Boolean(value)).sort().slice(-1)[0];
  const syncedAt = lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }) : null;
  const hasOtherPeriods = settings.initialScope === "standard" || settings.providers.some((id) => ["kimi_cli", "opencode", "copilot", "cursor", "antigravity"].includes(id));
  function toggleScope() {
    setScope((current) => current === "fiveHour" ? "weekly" : current === "weekly" && hasOtherPeriods ? "standard" : "fiveHour");
  }
  return (
    <main className={`appShell${minimal ? " appShell--minimal" : ""}`}>
      {minimal ? null : <Titlebar syncedAt={syncedAt} refreshing={refreshing || !settingsLoaded} onReload={() => refreshLiveLimits(true)}
        onSettings={() => setPanel((current) => current === "limits" ? null : "limits")} settingsOpen={panel === "limits"}
        onOptions={() => setPanel((current) => current === "options" ? null : "options")} optionsOpen={panel === "options"}
        onMinimal={() => void enterMinimal()} />}
      <section className={`workspace${panel && !minimal ? " workspace--settings" : ""}`}>
        {error && !minimal ? <div className="alert danger">{error}</div> : null}
        {panel === "options" && !minimal ? <AppOptions settings={settingsLoaded ? settings : undefined} saving={saving}
          settingsError={settingsError} onSettingsChange={changeSettings} onResetSettings={() => {
            changeSettings(structuredClone(DEFAULT_SETTINGS)); setScope("fiveHour"); setActiveRingTool("claude_code");
          }} /> : panel === "limits" && !minimal ?
          <LimitsSettings limits={liveLimits} providers={settings.providers} refreshing={refreshing} onRefresh={() => refreshLiveLimits(true)} /> : <>
            <div className="manaPanel"><ManaRing providers={settings.providers} limits={liveLimits} colors={settings.colors}
              activeTool={activeRingTool} scope={scope} onToggleScope={toggleScope} onSwitchTool={setActiveRingTool}
              minimal={minimal} staleMessage={staleMessage} onExitMinimal={() => void exitMinimal()} /></div>
            {minimal ? null : <div className="chipGrid" data-count={settings.providers.length}
              style={{ gridTemplateColumns: `repeat(${settings.providers.length}, minmax(0, 1fr))` }}>
              {settings.providers.map((id) => <ToolChipRail key={id} provider={id} color={settings.colors[id]} limits={liveLimits[id] ?? null} scope={scope} now={now} />)}
            </div>}
          </>}
      </section>
    </main>
  );
}
