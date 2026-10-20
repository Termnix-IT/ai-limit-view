import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { ChartNoAxesColumnIncreasing, TimerReset, Zap } from "lucide-react";
import { formatRemaining, formatResetAt, formatResetCountdown, limitTooltip, providerDetails } from "./limits";
import { QuotaStatus } from "./QuotaStatus";
import { ServiceMark } from "./ServiceMark";
import { PROVIDERS, providerStyle, providerVariant, providerWindows, selectedWindow } from "./providers";
import type { LimitScope, ProviderQuotaState, SubscriptionWindow, ToolKind } from "./types";

export function ToolChipRail({ provider, color, limits, scope, now }: {
  provider: ToolKind; color?: string; limits: ProviderQuotaState | null; scope: LimitScope; now: Date;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const reducedMotion = useReducedMotion();
  const activeWindow = selectedWindow(limits, scope);
  const expected = provider === "kimi_cli" ? [{ kind: "fiveHour", label: "5h" }, { kind: "monthly", label: "月" }]
    : provider === "copilot" || provider === "cursor" ? [{ kind: "monthly", label: "月" }]
    : [{ kind: "fiveHour", label: "5h" }, { kind: "weekly", label: "週" }];
  const actual = providerWindows(limits);
  const rows = expected.map((entry) => ({ ...entry, window: actual.find((window) => window.kind === entry.kind) }));
  if (scope === "standard" && activeWindow && !rows.some((entry) => entry.window?.id === activeWindow.id)) {
    rows[rows.length - 1] = { kind: activeWindow.kind, label: activeWindow.label, window: activeWindow };
  }
  const label = activeWindow ? shortWindowLabel(activeWindow) : scope === "weekly" ? "週" : scope === "fiveHour" ? "5h" : "標準";
  return <motion.section className={`chipRail ${providerVariant(provider)}`} style={providerStyle(provider, color)}
    initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.25 }}
    aria-label={`${PROVIDERS[provider].label} 状況`}>
    <div className="chipRail__head">
      <h2 className="chipRail__title" title={PROVIDERS[provider].label}><ServiceMark variant={providerVariant(provider)} mark={PROVIDERS[provider].mark} />{PROVIDERS[provider].shortLabel}</h2>
      <QuotaStatus provider={limits} label={`${PROVIDERS[provider].label} 残量取得の詳細`} expanded={showDetails} onClick={() => setShowDetails((open) => !open)} />
    </div>
    {limits?.status === "unavailable" && showDetails ? <div className="quotaDetails" role="status">{providerDetails(limits)}</div> : null}
    {rows.map((entry) => <div key={entry.kind} className="chip" data-selected={entry.window ? entry.window.id === activeWindow?.id : scope === entry.kind}
      data-warn={entry.window != null && entry.window.remainingPercent <= 15} title={limitTooltip(limits, entry.window)}>
      <span className="chip__lead">{entry.kind === "fiveHour" ? <Zap size={12} /> : <ChartNoAxesColumnIncreasing size={12} />}{entry.label}残</span>
      <span className="chip__value">{formatRemaining(entry.window)}</span>
    </div>)}
    <div className="chip" title={`${label}枠のリセット ${formatResetAt(activeWindow?.resetsAt)}`}>
      <span className="chip__lead"><TimerReset size={12} />{label}回復</span>
      <span className="chip__value">{formatResetCountdown(activeWindow?.resetsAt, now)}</span>
    </div>
  </motion.section>;
}
function shortWindowLabel(window: SubscriptionWindow): string {
  return window.kind === "fiveHour" ? "5h" : window.kind === "weekly" ? "週" : window.kind === "monthly" ? "月" : window.kind === "daily" ? "日" : window.label;
}
