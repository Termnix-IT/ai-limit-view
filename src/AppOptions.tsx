import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check, Download, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import appIcon from "../src-tauri/icons/32x32.png";
import { api } from "./api";
import { formatDateTime } from "./date";
import type { AppUpdate } from "./types";
import type { DisplaySettings, LimitScope, ProviderQuotaMap, SubscriptionWindow, ToolKind } from "./types";
import { DEFAULT_SETTINGS, PROVIDER_IDS, PROVIDERS, providerWindows } from "./providers";
import { ManaRing } from "./ManaRing";
import { DEFAULT_RING_SCALE, MAX_RING_SCALE, MIN_RING_SCALE, minimalRingPx, minimalRingZoom } from "./ringSize";

const PREVIEW_HIDE_DELAY_MS = 1500;
const INSTALL_POLL_MS = 2000;

const FULL = { usedPercent: 0, remainingPercent: 100, resetsAt: null };
const FALLBACK_WINDOWS: SubscriptionWindow[] = [
  { ...FULL, id: "fiveHour", label: "5時間", kind: "fiveHour" },
  { ...FULL, id: "weekly", label: "週間", kind: "weekly" },
];

/**
 * Every configured provider at 100%, so the preview shows full rings regardless of live quotas.
 * Known windows keep their labels and kinds (e.g. a monthly standard window); only the amount is replaced.
 */
function fullQuotas(providers: ToolKind[], limits: ProviderQuotaMap, scope: LimitScope): ProviderQuotaMap {
  return Object.fromEntries(providers.map((id) => {
    const known = providerWindows(limits[id]).map((entry) => ({ ...entry, ...FULL }));
    const windows = scope === "standard"
      ? known.length ? known : [{ ...FULL, id: "standard", label: "サービス標準", kind: "other" as const }]
      : known.some((entry) => entry.kind === scope) ? known : [...known, ...FALLBACK_WINDOWS.filter((entry) => entry.kind === scope)];
    return [id, { status: "ok", source: "preview", checkedAt: "", fiveHour: null, weekly: null, windows,
      message: null, errorCode: null, lastSuccessAt: null, nextRetryAt: null }];
  }));
}

/** Slider for the minimal ring size with the actual minimal ring shown while it is adjusted. */
function RingSizeOption({ scale, settings, limits, activeTool, scope, onChange }: {
  scale: number; settings: DisplaySettings; limits: ProviderQuotaMap; activeTool: ToolKind; scope: LimitScope;
  onChange: (scale: number) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const pointerHeld = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const showPreview = () => {
    window.clearTimeout(hideTimer.current);
    setPreviewing(true);
    if (!pointerHeld.current) hideTimer.current = window.setTimeout(() => setPreviewing(false), PREVIEW_HIDE_DELAY_MS);
  };
  const releasePointer = () => { pointerHeld.current = false; showPreview(); };
  const ringPx = minimalRingPx(scale);
  return (
    <div className="displayOptions__ringSize">
      <div className="displayOptions__ringSizeHead">
        <label htmlFor="ring-size">ミニマル表示のリングサイズ</label>
        <output htmlFor="ring-size">{scale}%<span>{ringPx}px</span></output>
      </div>
      <div className="displayOptions__ringSizeControl">
        <input id="ring-size" type="range" min={MIN_RING_SCALE} max={MAX_RING_SCALE} step={1} value={scale}
          aria-valuetext={`${scale}%（${ringPx}px）`}
          onPointerDown={() => {
            // The drag can end outside the slider, so listen on the window.
            pointerHeld.current = true; showPreview();
            window.addEventListener("pointerup", releasePointer, { once: true });
            window.addEventListener("pointercancel", releasePointer, { once: true });
          }}
          onFocus={showPreview} onKeyDown={showPreview}
          onBlur={() => { pointerHeld.current = false; window.clearTimeout(hideTimer.current); setPreviewing(false); }}
          onChange={(event) => { showPreview(); onChange(Number(event.target.value)); }} />
        <button type="button" className="refreshButton" disabled={scale === DEFAULT_RING_SCALE}
          title="リングサイズを従来の大きさ（50%）に戻す"
          onClick={() => { showPreview(); onChange(DEFAULT_RING_SCALE); }}>50%に戻す</button>
      </div>
      <p className="displayOptions__hint">1%で72px、50%で従来の180px、100%で2倍の360pxです。</p>
      {/* A display-only copy of the minimal ring; inert keeps its buttons out of focus and clicks. */}
      {previewing ? <div className="ringPreview" data-testid="ring-size-preview" aria-hidden="true" ref={(element) => { if (element) element.inert = true; }}>
        <ManaRing providers={settings.providers} limits={fullQuotas(settings.providers, limits, scope)} colors={settings.colors}
          activeTool={activeTool} scope={scope} onToggleScope={() => {}} onSwitchTool={() => {}} onExitMinimal={() => {}}
          minimal minimalZoom={minimalRingZoom(scale)} />
        <span className="ringPreview__label">実寸 {ringPx}px</span>
      </div> : null}
    </div>
  );
}

export function AppOptions({ settings, limits = {}, activeTool, scope, onSettingsChange, onResetSettings, saving = false, settingsError = null }: {
  settings?: DisplaySettings;
  /** Live quotas whose window labels the ring size preview reuses; the amounts are always shown as 100%. */
  limits?: ProviderQuotaMap;
  /** Outer ring and scope shown by the ring size preview; defaults to the first provider and the initial scope. */
  activeTool?: ToolKind;
  scope?: LimitScope;
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
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const mounted = useRef(false);
  const checkRunning = useRef(false);
  const openRunning = useRef(false);
  const installRunning = useRef(false);

  useEffect(() => {
    mounted.current = true;
    void getVersion().then((value) => { if (mounted.current) setVersion(value); })
      .catch(() => { if (mounted.current) setVersion("取得できません"); });
    // An install started before this panel was reopened keeps running in Rust.
    let poll: number | undefined;
    const syncInstalling = () => api.appUpdateInstalling().then((running) => {
      if (!mounted.current || installRunning.current) return;
      setInstalling(running);
      window.clearTimeout(poll);
      if (running) poll = window.setTimeout(() => void syncInstalling(), INSTALL_POLL_MS);
    }).catch(() => {});
    void syncInstalling();
    return () => { mounted.current = false; window.clearTimeout(poll); };
  }, []);

  async function checkUpdate() {
    if (checkRunning.current) return;
    checkRunning.current = true;
    setChecking(true);
    setError(null);
    setResult(null);
    setInstallError(null);
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

  async function installUpdate() {
    if (installRunning.current) return;
    installRunning.current = true;
    setInstalling(true);
    setInstallError(null);
    // On success the installer exits and restarts the app, so only failure returns here.
    try { await api.installAppUpdate(); }
    catch (cause) {
      if (mounted.current) setInstallError(typeof cause === "string" ? cause : "更新をインストールできませんでした。配布ページからインストーラーを取得してください。");
    } finally {
      installRunning.current = false;
      if (mounted.current) setInstalling(false);
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
          </select>
          <input type="color" aria-label={`${PROVIDERS[provider].label}のリング色`} value={settings.colors[provider] ?? PROVIDERS[provider].color}
            onChange={(event) => onSettingsChange({ ...settings, colors: { ...settings.colors, [provider]: event.target.value } })} />
          {provider !== "codex" && provider !== "claude_code" ? <p className="displayOptions__hint">{PROVIDERS[provider].note}</p> : null}
        </div>)}
        <RingSizeOption scale={settings.ringScale} settings={settings} limits={limits}
          activeTool={activeTool && settings.providers.includes(activeTool) ? activeTool : settings.providers[0]}
          scope={scope ?? settings.initialScope} onChange={(ringScale) => onSettingsChange({ ...settings, ringScale })} />
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
          disabled={checking || installing} onClick={() => void checkUpdate()}>
          {checking ? <LoaderCircle size={12} className="appOptions__spinner" /> : <RefreshCw size={12} />}
          {checking ? "確認中…" : "更新を確認"}
        </button>
        <div className="appOptions__result" role={error ? "alert" : "status"} data-state={checking ? "loading" : error ? "error" : result?.available ? "available" : "ok"}>
          {checking ? <p>更新情報を取得しています…</p> : error ? <p><TriangleAlert size={13} />{error}</p> : result ? <>
            <p>{result.available ? <RefreshCw size={13} /> : <Check size={13} />}
              {result.available ? `v${result.latestVersion} が公開されています。` : "新しい更新はありません。"}</p>
            <span>確認 {formatDateTime(result.checkedAt)}</span>
          </> : null}
        </div>
        {result?.available && !checking ? <button type="button" className="refreshButton" aria-busy={installing}
          disabled={installing} onClick={() => void installUpdate()}>
          {installing ? <LoaderCircle size={12} className="appOptions__spinner" /> : <Download size={12} />}
          {installing ? "更新中…" : "更新してアプリを再起動"}
        </button> : null}
        {installing ? <p role="status">ダウンロードとインストールが終わると、アプリは自動で再起動します。</p> : null}
        {installError ? <p className="appOptions__error" role="alert">{installError}</p> : null}
      </section>
      <footer className="appOptions__footer">
        <button type="button" className="refreshButton" disabled={opening} onClick={() => void openReleasePage()}>
          <ExternalLink size={12} />配布ページを開く
        </button>
        <p>アプリ内で更新できない場合は、配布ページからインストーラーを取得してください。</p>
        {openError ? <p className="appOptions__error" role="alert">{openError}</p> : null}
      </footer>
    </div>
  );
}
