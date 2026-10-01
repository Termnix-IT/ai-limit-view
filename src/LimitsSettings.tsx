import { RefreshCw } from "lucide-react";
import { formatDateTime } from "./date";
import { formatRemaining, formatResetAt } from "./limits";
import { hasCachedQuota } from "./quotaRefresh";
import { QuotaStatus } from "./QuotaStatus";
import type { LiveQuotaState, ProviderQuotaState } from "./types";

export function LimitsSettings({ limits, refreshing, onRefresh }: {
  limits: LiveQuotaState | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="limitsSettings">
      <header className="limitsSettings__head">
        <div>
          <h1>取得状況</h1>
          <p>Codex は1分、Claude は5分ごとに更新<br />取得制限が続く場合は待機時間を延長</p>
        </div>
        <button type="button" className="refreshButton" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw size={12} />{refreshing ? "取得中" : "再取得"}
        </button>
      </header>
      <ProviderDetails label="Codex" variant="codex" provider={limits?.codex ?? null} />
      <ProviderDetails label="Claude Code" variant="claude" provider={limits?.claude ?? null} />
      <p className="limitsSettings__hint">数値・枠をクリック：5時間枠 ↔ 週間枠<br />アイコン・ホイール：外側リングと中央残量のサービスを選択</p>
    </div>
  );
}

function ProviderDetails({ label, variant, provider }: {
  label: string;
  variant: "codex" | "claude";
  provider: ProviderQuotaState | null;
}) {
  return (
    <section className={`providerDetails ${variant}`} aria-label={`${label} 取得状況`}>
      <div className="providerDetails__head">
        <h2>{label}</h2>
        <QuotaStatus provider={provider} />
      </div>
      <dl>
        <div><dt>取得元</dt><dd>{provider?.source ?? (variant === "codex" ? "Codex app-server" : "OpenUsage")}</dd></div>
        <div><dt>最終確認</dt><dd>{provider ? formatDateTime(provider.checkedAt) : "—"}</dd></div>
        {provider?.status === "unavailable" ? <>
          <div><dt>最終取得</dt><dd>{provider.lastSuccessAt ? formatDateTime(provider.lastSuccessAt) : "—"}</dd></div>
          <div><dt>次回再試行</dt><dd>{provider.nextRetryAt ? formatDateTime(provider.nextRetryAt) : "—"}</dd></div>
        </> : null}
        <div><dt>5時間枠</dt><dd>{formatRemaining(provider?.fiveHour)}<span>リセット {formatResetAt(provider?.fiveHour?.resetsAt)}</span></dd></div>
        <div><dt>週間枠</dt><dd>{formatRemaining(provider?.weekly)}<span>リセット {formatResetAt(provider?.weekly?.resetsAt)}</span></dd></div>
      </dl>
      {hasCachedQuota(provider) ? <p className="providerDetails__message">表示中の残量は前回の取得値です。</p> : null}
      {provider?.message ? <p className="providerDetails__message" role="status">{provider.message}</p> : null}
    </section>
  );
}
