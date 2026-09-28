import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { LimitsSettings } from "./LimitsSettings";
import { ManaRing } from "./ManaRing";
import { Titlebar } from "./Titlebar";
import { ToolChipRail } from "./ToolChipRail";
import type { LimitScope, LiveLimits, ToolKind } from "./types";

const NORMAL_SIZE: [number, number] = [400, 380];
const MINIMAL_SIZE: [number, number] = [200, 200];

export function App() {
  const [liveLimits, setLiveLimits] = useState<LiveLimits | null>(null);
  const liveRefreshRunning = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [minimal, setMinimal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeRingTool, setActiveRingTool] = useState<ToolKind>("claude_code");
  const [scope, setScope] = useState<LimitScope>("fiveHour");

  const refreshLiveLimits = useCallback(async () => {
    if (liveRefreshRunning.current) return;
    liveRefreshRunning.current = true;
    setRefreshing(true);
    try {
      setLiveLimits(await api.getLiveLimits());
    } catch {
      const failedProvider = {
        status: "unavailable" as const,
        checkedAt: new Date().toISOString(),
        fiveHour: null,
        weekly: null,
        message: "残量の取得処理に失敗しました。再読み込みしてください。",
        errorCode: "fetch_failed",
      };
      setLiveLimits({
        codex: { ...failedProvider, source: "Codex app-server" },
        claude: { ...failedProvider, source: "OpenUsage" },
      });
    } finally {
      liveRefreshRunning.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshLiveLimits();
    const timer = window.setInterval(() => void refreshLiveLimits(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshLiveLimits]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const enterMinimal = useCallback(async () => {
    try {
      const win = getCurrentWindow();
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
      await win.setSize(new LogicalSize(NORMAL_SIZE[0], NORMAL_SIZE[1]));
      setMinimal(false);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const syncedAt = liveLimits
    ? new Date(liveLimits.codex.checkedAt).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <main className={`appShell${minimal ? " appShell--minimal" : ""}`}>
      {minimal ? null : (
        <Titlebar
          syncedAt={syncedAt}
          refreshing={refreshing}
          onReload={() => void refreshLiveLimits()}
          onSettings={() => setSettingsOpen((open) => !open)}
          settingsOpen={settingsOpen}
          onMinimal={() => void enterMinimal()}
        />
      )}
      <section className={`workspace${settingsOpen && !minimal ? " workspace--settings" : ""}`}>
        {error && !minimal ? <div className="alert danger">{error}</div> : null}
        {settingsOpen && !minimal ? (
          <LimitsSettings limits={liveLimits} refreshing={refreshing} onRefresh={() => void refreshLiveLimits()} />
        ) : (
          <>
            <div className="manaPanel">
              <ManaRing
                codexRemainingPercent={liveLimits?.codex[scope]?.remainingPercent ?? null}
                claudeRemainingPercent={liveLimits?.claude[scope]?.remainingPercent ?? null}
                activeTool={activeRingTool}
                scope={scope}
                onToggleScope={() => setScope((current) => current === "fiveHour" ? "weekly" : "fiveHour")}
                onSwitchTool={setActiveRingTool}
                minimal={minimal}
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
