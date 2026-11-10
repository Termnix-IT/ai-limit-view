import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check, Download, ExternalLink, Info, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import type { KeyboardEvent } from "react";
import appIcon from "../src-tauri/icons/32x32.png";
import { api } from "./api";
import { formatDateTime } from "./date";
import type { AppUpdate } from "./types";
import type { DisplaySettings, LimitScope, ProviderQuotaMap, SubscriptionWindow, ToolKind } from "./types";
import { DEFAULT_SETTINGS, PROVIDER_IDS, PROVIDERS, providerWindows } from "./providers";
import { ManaRing } from "./ManaRing";
import { DEFAULT_RING_SCALE, MAX_RING_SCALE, MIN_RING_SCALE, minimalRingPx, minimalRingZoom } from "./ringSize";

const PREVIEW_HIDE_DELAY_MS = 1500;

type OptionsTab = "rings" | "display" | "app";
const TABS: { id: OptionsTab; label: string }[] = [
  { id: "rings", label: "リング" }, { id: "display", label: "表示" }, { id: "app", label: "アプリ" },
];
const SCOPES: { id: LimitScope; label: string; title?: string }[] = [
  { id: "fiveHour", label: "5時間" }, { id: "weekly", label: "週間" },
  { id: "standard", label: "サービス標準", title: "日次・月間など各サービスの利用枠を表示します。取得できない枠は — です。" },
];
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
        <output htmlFor="ring-size" title="1%で72px、50%で180px、100%で360px">{scale}%<span>{ringPx}px</span></output>
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
        <button type="button" className="iconButton" disabled={scale === DEFAULT_RING_SCALE}
          aria-label="リングサイズを50%に戻す" title="リングサイズを50%（180px）に戻す"
          onClick={() => { showPreview(); onChange(DEFAULT_RING_SCALE); }}><RotateCcw size={13} aria-hidden="true" /></button>
      </div>
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

  const [tab, setTab] = useState<OptionsTab>(settings ? "rings" : "app");
  const [openNote, setOpenNote] = useState<number | null>(null);
  const tabRefs = useRef<Partial<Record<OptionsTab, HTMLButtonElement | null>>>({});
  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    const current = TABS.findIndex((entry) => entry.id === tab);
    const index = event.key === "ArrowRight" ? (current + 1) % TABS.length
      : event.key === "ArrowLeft" ? (current + TABS.length - 1) % TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (index < 0) return;
    event.preventDefault();
    setTab(TABS[index].id);
    tabRefs.current[TABS[index].id]?.focus();
  }
  const editable = settings && onSettingsChange ? { settings, onSettingsChange } : null;
  const loadingSettings = <p className="appOptions__empty">表示設定を読み込んでいます…</p>;

  return (
    <div className="appOptions">
      <h1 className="srOnly">オプション</h1>
      <div className="appOptions__tabbar">
        <div role="tablist" aria-label="オプションの分類" onKeyDown={moveTab}>
          {TABS.map((entry) => <button key={entry.id} type="button" role="tab" id={`options-tab-${entry.id}`}
            aria-selected={tab === entry.id} aria-controls="options-panel" tabIndex={tab === entry.id ? 0 : -1}
            ref={(element) => { tabRefs.current[entry.id] = element; }} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
        </div>
        {settings ? <span className="appOptions__save" role="status" data-state={saving ? "saving" : settingsError ? "error" : "saved"}>
          {saving ? <LoaderCircle size={11} className="appOptions__spinner" aria-hidden="true" />
            : settingsError ? <TriangleAlert size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
          {saving ? "保存中…" : settingsError ? "設定エラー" : "自動保存"}
        </span> : null}
      </div>
      {settingsError ? <p className="appOptions__error" role="alert">{settingsError}</p> : null}

      <div role="tabpanel" id="options-panel" aria-labelledby={`options-tab-${tab}`} className="appOptions__panel">
        {tab === "rings" ? editable ? <section className="displayOptions" aria-label="リングとサービス">
          <div className="displayOptions__row"><h2>リングの本数</h2><div className="segmented" role="group" aria-label="リングの本数">
            {[1, 2, 3].map((count) => <button type="button" key={count} aria-label={`${count}本`} aria-pressed={editable.settings.providers.length === count}
              onClick={() => {
                const providers = editable.settings.providers.slice(0, count);
                for (const id of PROVIDER_IDS) { if (providers.length >= count) break; if (!providers.includes(id)) providers.push(id); }
                editable.onSettingsChange({ ...editable.settings, providers });
              }}>{count}</button>)}
          </div></div>
          {editable.settings.providers.map((provider, index) => {
            const note = provider !== "codex" && provider !== "claude_code" ? PROVIDERS[provider].note : null;
            return <div className="displayOptions__slot" key={index}>
              <span className="displayOptions__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <label className="srOnly" htmlFor={`ring-provider-${index}`}>リング{index + 1}のサービス</label>
              <select id={`ring-provider-${index}`} className={note ? undefined : "displayOptions__wide"} value={provider} onChange={(event) => {
                const next = event.target.value as ToolKind;
                const providers = [...editable.settings.providers];
                const duplicate = providers.indexOf(next);
                if (duplicate >= 0) providers[duplicate] = provider;
                providers[index] = next;
                setOpenNote(null);
                editable.onSettingsChange({ ...editable.settings, providers });
              }}>
                {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}{PROVIDERS[id].conditional ? "（条件付き）" : ""}</option>)}
              </select>
              {note ? <button type="button" className="iconButton" aria-label={`${PROVIDERS[provider].label}の取得条件`}
                aria-expanded={openNote === index} aria-controls={`ring-note-${index}`} title={note}
                onClick={() => setOpenNote((current) => current === index ? null : index)}><Info size={13} aria-hidden="true" /></button>
                : null}
              <input type="color" aria-label={`${PROVIDERS[provider].label}のリング色`}
                value={editable.settings.colors[provider] ?? PROVIDERS[provider].color}
                onChange={(event) => editable.onSettingsChange({ ...editable.settings,
                  colors: { ...editable.settings.colors, [provider]: event.target.value } })} />
              {note && openNote === index ? <p className="displayOptions__hint" id={`ring-note-${index}`}>{note}</p> : null}
            </div>;
          })}
        </section> : loadingSettings : null}

        {tab === "display" ? editable ? <section className="displayOptions" aria-label="表示">
          <div className="displayOptions__row"><h2 id="initial-scope-label">起動時の表示枠</h2>
            <div className="segmented" role="group" aria-labelledby="initial-scope-label">
              {SCOPES.map((entry) => <button type="button" key={entry.id} aria-pressed={editable.settings.initialScope === entry.id}
                title={entry.title} onClick={() => editable.onSettingsChange({ ...editable.settings, initialScope: entry.id })}>{entry.label}</button>)}
            </div>
          </div>
          <RingSizeOption scale={editable.settings.ringScale} settings={editable.settings} limits={limits}
            activeTool={activeTool && editable.settings.providers.includes(activeTool) ? activeTool : editable.settings.providers[0]}
            scope={scope ?? editable.settings.initialScope}
            onChange={(ringScale) => editable.onSettingsChange({ ...editable.settings, ringScale })} />
        </section> : loadingSettings : null}

        {tab === "app" ? <section className="appOptions__app" aria-label="アプリ">
          <div className="displayOptions__row">
            <div className="appOptions__identity"><img src={appIcon} width={16} height={16} alt="" /><h2>LimitView</h2>
              <span title="現在のバージョン">{version ? (version === "取得できません" ? version : `v${version}`) : "確認中…"}</span></div>
            <button type="button" className="refreshButton" aria-label="更新を確認" aria-busy={checking}
              disabled={checking || installing} onClick={() => void checkUpdate()}>
              {checking ? <LoaderCircle size={12} className="appOptions__spinner" /> : <RefreshCw size={12} />}
              {checking ? "確認中…" : "更新を確認"}
            </button>
          </div>
          <div className="appOptions__result" role={error ? "alert" : "status"} data-state={checking ? "loading" : error ? "error" : result?.available ? "available" : "ok"}>
            {checking ? <p>更新情報を取得しています…</p> : error ? <p><TriangleAlert size={13} />{error}</p> : result ? <>
              <p>{result.available ? <RefreshCw size={13} /> : <Check size={13} />}
                {result.available ? `v${result.latestVersion} が公開されています。` : "新しい更新はありません。"}</p>
              <span>確認 {formatDateTime(result.checkedAt)}</span>
            </> : null}
          </div>
          {result?.available && !checking ? <button type="button" className="refreshButton appOptions__install" aria-busy={installing}
            disabled={installing} onClick={() => void installUpdate()}>
            {installing ? <LoaderCircle size={12} className="appOptions__spinner" /> : <Download size={12} />}
            {installing ? "更新中…" : "更新してアプリを再起動"}
          </button> : null}
          {installing ? <p role="status">ダウンロードとインストールが終わると、アプリは自動で再起動します。</p> : null}
          {installError ? <p className="appOptions__error" role="alert">{installError}</p> : null}
          <div className="displayOptions__row">
            <span>アプリ内で更新できないとき</span>
            <button type="button" className="refreshButton" disabled={opening} onClick={() => void openReleasePage()}>
              <ExternalLink size={12} />配布ページを開く
            </button>
          </div>
          {openError ? <p className="appOptions__error" role="alert">{openError}</p> : null}
          {editable ? <div className="displayOptions__row">
            <span>リング・色・サイズ・表示枠</span>
            <button type="button" className="refreshButton danger"
              onClick={() => onResetSettings ? onResetSettings() : editable.onSettingsChange(structuredClone(DEFAULT_SETTINGS))}>初期設定に戻す</button>
          </div> : null}
        </section> : null}
      </div>
    </div>
  );
}
