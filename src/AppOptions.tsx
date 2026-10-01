import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Check, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import appIcon from "../src-tauri/icons/32x32.png";
import { api } from "./api";
import { formatDateTime } from "./date";
import type { AppUpdate } from "./types";

export function AppOptions() {
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
      <header className="appOptions__head"><h1>オプション</h1><p>バージョンとアプリの更新</p></header>
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
