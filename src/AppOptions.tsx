import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import appIcon from "../src-tauri/icons/32x32.png";
import { api } from "./api";
import { formatDateTime } from "./date";
import type { AppUpdate } from "./types";
import type { DisplaySettings, LimitScope, ToolKind } from "./types";
import { DEFAULT_SETTINGS, PROVIDER_IDS, PROVIDERS } from "./providers";

export function AppOptions({ settings, onSettingsChange, onResetSettings, saving = false, settingsError = null }: {
  settings?: DisplaySettings;
  onSettingsChange?: (settings: DisplaySettings) => void;
  onResetSettings?: () => void;
  saving?: boolean;
  settingsError?: string | null;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [result, setResult] = useState<AppUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);
  const checkRunning = useRef(false);
  const openRunning = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void getVersion().then((value) => { if (mounted.current) setVersion(value); })
      .catch(() => { if (mounted.current) setVersion("取得できません"); });
    return () => { mounted.current = false; };
  }, []);

  async function checkUpdate() {
    if (checkRunning.current) return;
    checkRunning.current = true;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const update = await api.checkAppUpdate();
      if (mounted.current) { setResult(update); setVersion(update.currentVersion); }
    } catch (cause) {
      if (mounted.current) setError(typeof cause === "string" ? cause : "更新情報を確認できませんでした。時間をおいて再試行してください。");
    } finally {
      checkRunning.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  async function openReleasePage() {
    if (openRunning.current) return;
    openRunning.current = true;
    setOpening(true);
    setOpenError(null);
    try { await api.openReleasePage(); }
    catch { if (mounted.current) setOpenError("配布ページを開けませんでした。既定のブラウザーを確認してください。"); }
    finally { openRunning.current = false; if (mounted.current) setOpening(false); }
  }

  return (
    <div className="appOptions">
      <header className="appOptions__head"><h1>オプション</h1><p>{settings ? "リングと表示サービス" : "バージョンとアプリの更新"}</p></header>
      {settings && onSettingsChange ? <section className="displayOptions" aria-label="表示設定">
        <div className="displayOptions__count"><h2>リングの本数</h2><div role="group" aria-label="リングの本数">
          {[1, 2, 3].map((count) => <button type="button" key={count} aria-label={`${count}本`} aria-pressed={settings.providers.length === count}
            onClick={() => {
              const providers = settings.providers.slice(0, count);
              for (const id of PROVIDER_IDS) { if (providers.length >= count) break; if (!providers.includes(id)) providers.push(id); }
              onSettingsChange({ ...settings, providers });
            }}>{count}</button>)}
        </div></div>
        {settings.providers.map((provider, index) => <div className="displayOptions__slot" key={index}>
          <span className="displayOptions__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <label className="srOnly" htmlFor={`ring-provider-${index}`}>リング{index + 1}のサービス</label>
          <select id={`ring-provider-${index}`} value={provider} onChange={(event) => {
            const next = event.target.value as ToolKind;
            const providers = [...settings.providers];
            const duplicate = providers.indexOf(next);
            if (duplicate >= 0) providers[duplicate] = provider;
            providers[index] = next;
            onSettingsChange({ ...settings, providers });
          }}>
            {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}{PROVIDERS[id].conditional ? "（条件付き）" : ""}</option>)}
            <option disabled>Gemini CLI（取得方式を確認中）</option>
          </select>
          <input type="color" aria-label={`${PROVIDERS[provider].label}のリング色`} value={settings.colors[provider] ?? PROVIDERS[provider].color}
            onChange={(event) => onSettingsChange({ ...settings, colors: { ...settings.colors, [provider]: event.target.value } })} />
          {provider !== "codex" && provider !== "claude_code" ? <p className="displayOptions__hint">{PROVIDERS[provider].note}</p> : null}
        </div>)}
        <div className="displayOptions__scope"><label htmlFor="initial-scope">初期表示枠</label>
          <select id="initial-scope" value={settings.initialScope} onChange={(event) => onSettingsChange({ ...settings, initialScope: event.target.value as LimitScope })}>
            <option value="fiveHour">5時間</option><option value="weekly">週間</option><option value="standard">サービス標準</option>
          </select>
        </div>
        <p>サービス標準では、日次・月間など各サービスの利用枠を表示します。取得できない枠は — です。</p>
        <div className="displayOptions__footer"><span role="status">{saving ? "保存中…" : settingsError ? "設定を保存できません" : "変更は自動保存"}</span>
          <button type="button" className="refreshButton" onClick={() => onResetSettings ? onResetSettings() : onSettingsChange(structuredClone(DEFAULT_SETTINGS))}>初期設定に戻す</button>
        </div>
        {settingsError ? <p className="appOptions__error" role="alert">{settingsError}</p> : null}
      </section> : null}
      <section className="appOptions__identity" aria-label="現在のバージョン">
        <img src={appIcon} width={32} height={32} alt="" />
        <div><h2>LimitView</h2><span>現在のバージョン</span><strong>{version ? (version === "取得できません" ? version : `v${version}`) : "確認中…"}</strong></div>
      </section>
      <section className="appOptions__updates" aria-labelledby="app-updates-heading">
        <h2 id="app-updates-heading">アプリの更新</h2>
        <p>GitHub Releases の最新版を確認します。</p>
        <button type="button" className="refreshButton" aria-label="更新を確認" aria-busy={checking}
          disabled={checking} onClick={() => void checkUpdate()}>
          {checking ? <LoaderCircle size={12} className="appOptions__spinner" /> : <RefreshCw size={12} />}
          {checking ? "確認中…" : "更新を確認"}
        </button>
        <div className="appOptions__result" role={error ? "alert" : "status"} data-state={checking ? "loading" : error ? "error" : result?.available ? "available" : "ok"}>
          {checking ? <p>更新情報を取得しています…</p> : error ? <p><TriangleAlert size={13} />{error}</p> : result ? <>
            <p>{result.available ? <RefreshCw size={13} /> : <Check size={13} />}
              {result.available ? `v${result.latestVersion} が公開されています。` : "新しい更新はありません。"}</p>
            <span>公開版 v{result.latestVersion} · 確認 {formatDateTime(result.checkedAt)}</span>
          </> : null}
        </div>
      </section>
      <footer className="appOptions__footer">
        <button type="button" className="refreshButton" disabled={opening} onClick={() => void openReleasePage()}>
          <ExternalLink size={12} />配布ページを開く
        </button>
        <p>更新する場合は配布ページからインストーラーを取得してください。</p>
        {openError ? <p className="appOptions__error" role="alert">{openError}</p> : null}
      </footer>
    </div>
  );
}
