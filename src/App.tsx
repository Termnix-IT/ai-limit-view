import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { LimitsSettings } from "./LimitsSettings";
import { ManaRing } from "./ManaRing";
import { Titlebar } from "./Titlebar";
import { ToolChipRail } from "./ToolChipRail";
import { limitTooltip } from "./limits";
import { applyQuotaResult, hasCachedQuota, refreshDelay } from "./quotaRefresh";
import type { LimitProvider, LimitScope, LiveProviderLimits, LiveQuotaState, ToolKind } from "./types";

const NORMAL_SIZE: [number, number] = [400, 380];
const MINIMAL_SIZE: [number, number] = [200, 200];

export function App() {
  const [liveLimits, setLiveLimits] = useState<LiveQuotaState>({ codex: null, claude: null });
  const liveRefreshRunning = useRef({ codex: false, claude_code: false });
  const schedule = useRef({
    codex: { nextAt: 0, cooldownUntil: 0, rateLimitFailures: 0 },
    claude_code: { nextAt: 0, cooldownUntil: 0, rateLimitFailures: 0 },
  });
  const mounted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [minimal, setMinimal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeRingTool, setActiveRingTool] = useState<ToolKind>("claude_code");
  const [scope, setScope] = useState<LimitScope>("fiveHour");

  const refreshProvider = useCallback(async (provider: LimitProvider, manual: boolean) => {
    const timing = schedule.current[provider];
    if (liveRefreshRunning.current[provider] || Date.now() < timing.cooldownUntil
      || (!manual && Date.now() < timing.nextAt)) return;
    liveRefreshRunning.current[provider] = true;
    setRefreshing(true);
    const key = provider === "codex" ? "codex" : "claude";
    let result: LiveProviderLimits;
    try {
      result = await api.getProviderLimits(provider);
    } catch {
      result = {
        status: "unavailable",
        source: provider === "codex" ? "Codex app-server" : "OpenUsage",
        checkedAt: new Date().toISOString(),
        fiveHour: null,
        weekly: null,
        message: "残量の取得処理に失敗しました。再読み込みしてください。",
        errorCode: "fetch_failed",
      };
    }
    const rateLimited = provider === "claude_code" && result.status === "unavailable" && result.errorCode === "rate_limited";
    timing.rateLimitFailures = rateLimited ? timing.rateLimitFailures + 1 : 0;
    timing.nextAt = Date.now() + refreshDelay(provider, timing.rateLimitFailures);
    timing.cooldownUntil = rateLimited ? timing.nextAt : 0;
    liveRefreshRunning.current[provider] = false;
    if (!mounted.current) return;
    const nextRetryAt = result.status === "unavailable" ? new Date(timing.nextAt).toISOString() : null;
    setLiveLimits((current) => ({ ...current, [key]: applyQuotaResult(current[key], result, nextRetryAt) }));
    setRefreshing(Object.values(liveRefreshRunning.current).some(Boolean));
  }, []);

  const refreshLiveLimits = useCallback((manual = false) => {
    void refreshProvider("codex", manual);
    void refreshProvider("claude_code", manual);
  }, [refreshProvider]);

  useEffect(() => {
    mounted.current = true;
    void refreshLiveLimits();
    const timer = window.setInterval(() => {
      setNow(new Date());
      void refreshLiveLimits();
    }, 1000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refreshLiveLimits]);

  const enterMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setShadow(false);
      await win.setSize(new LogicalSize(MINIMAL_SIZE[0], MINIMAL_SIZE[1]));
      await win.setAlwaysOnTop(true);
      setSettingsOpen(false);
      setMinimal(true);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const exitMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(false);
      // Windows changes the client area when shadow is restored; resize afterward.
      await win.setShadow(true);
      await win.setSize(new LogicalSize(NORMAL_SIZE[0], NORMAL_SIZE[1]));
      setMinimal(false);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const selectedProvider = activeRingTool === "codex" ? liveLimits.codex : liveLimits.claude;
  const staleMessage = hasCachedQuota(selectedProvider) ? limitTooltip(selectedProvider, selectedProvider?.[scope]) : null;
  const lastCheckedAt = [liveLimits.codex?.lastSuccessAt, liveLimits.claude?.lastSuccessAt]
    .filter((value): value is string => Boolean(value)).sort().slice(-1)[0];
  const syncedAt = lastCheckedAt
    ? new Date(lastCheckedAt).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <main className={`appShell${minimal ? " appShell--minimal" : ""}`}>
      {minimal ? null : (
        <Titlebar
          syncedAt={syncedAt}
          refreshing={refreshing}
          onReload={() => void refreshLiveLimits(true)}
          onSettings={() => setSettingsOpen((open) => !open)}
          settingsOpen={settingsOpen}
          onMinimal={() => void enterMinimal()}
        />
      )}
      <section className={`workspace${settingsOpen && !minimal ? " workspace--settings" : ""}`}>
        {error && !minimal ? <div className="alert danger">{error}</div> : null}
        {settingsOpen && !minimal ? (
          <LimitsSettings limits={liveLimits} refreshing={refreshing} onRefresh={() => void refreshLiveLimits(true)} />
        ) : (
          <>
            <div className="manaPanel">
              <ManaRing
                codexRemainingPercent={liveLimits.codex?.[scope]?.remainingPercent ?? null}
                claudeRemainingPercent={liveLimits.claude?.[scope]?.remainingPercent ?? null}
                activeTool={activeRingTool}
                scope={scope}
                onToggleScope={() => setScope((current) => current === "fiveHour" ? "weekly" : "fiveHour")}
                onSwitchTool={setActiveRingTool}
                minimal={minimal}
                staleMessage={staleMessage}
                onExitMinimal={() => void exitMinimal()}
              />
            </div>
            {minimal ? null : (
              <div className="chipGrid">
                <ToolChipRail variant="codex" limits={liveLimits?.codex ?? null} scope={scope} now={now} />
                <ToolChipRail variant="claude" limits={liveLimits?.claude ?? null} scope={scope} now={now} />
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
