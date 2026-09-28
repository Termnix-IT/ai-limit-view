import { RefreshCw } from "lucide-react";
import { formatDateTime } from "./date";
import { formatRemaining, formatResetAt } from "./limits";
import { QuotaStatus } from "./QuotaStatus";
import type { LiveLimits, LiveProviderLimits } from "./types";

export function LimitsSettings({ limits, refreshing, onRefresh }: {
  limits: LiveLimits | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="limitsSettings">
      <header className="limitsSettings__head">
        <div>
          <h1>取得状況</h1>
          <p>残量は60秒ごとに自動更新</p>
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
  provider: LiveProviderLimits | null;
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
        <div><dt>5時間枠</dt><dd>{formatRemaining(provider?.fiveHour)}<span>リセット {formatResetAt(provider?.fiveHour?.resetsAt)}</span></dd></div>
        <div><dt>週間枠</dt><dd>{formatRemaining(provider?.weekly)}<span>リセット {formatResetAt(provider?.weekly?.resetsAt)}</span></dd></div>
      </dl>
      {provider?.message ? <p className="providerDetails__message" role="status">{provider.message}</p> : null}
    </section>
  );
}
