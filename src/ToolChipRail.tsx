import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { ChartNoAxesColumnIncreasing, TimerReset, Zap } from "lucide-react";
import { formatRemaining, formatResetAt, formatResetCountdown, limitTooltip, providerDetails } from "./limits";
import { QuotaStatus } from "./QuotaStatus";
import { ServiceMark } from "./ServiceMark";
import type { LimitScope, ProviderQuotaState } from "./types";

const TITLE = { codex: "Codex", claude: "Claude Code" } as const;

export function ToolChipRail({ variant, limits, scope, now }: {
  variant: "codex" | "claude";
  limits: ProviderQuotaState | null;
  scope: LimitScope;
  now: Date;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const reducedMotion = useReducedMotion();
  const failed = limits?.status === "unavailable";
  const activeWindow = limits?.[scope];
  const resetAt = activeWindow?.resetsAt;
  const scopeLabel = scope === "fiveHour" ? "5h" : "週";
  return (
    <motion.section
      className={`chipRail ${variant}`}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.25 }}
      aria-label={`${TITLE[variant]} 状況`}
    >
      <div className="chipRail__head">
        <h2 className="chipRail__title"><ServiceMark variant={variant} />{TITLE[variant]}</h2>
        <QuotaStatus provider={limits} label={`${TITLE[variant]} 残量取得の詳細`}
          expanded={showDetails} onClick={() => setShowDetails((open) => !open)} />
      </div>
      {failed && showDetails ? <div className="quotaDetails" role="status">{providerDetails(limits)}</div> : null}
      <div className="chip" data-selected={scope === "fiveHour"}
        data-warn={limits?.fiveHour != null && limits.fiveHour.remainingPercent <= 15} title={limitTooltip(limits, limits?.fiveHour)}>
        <span className="chip__lead"><Zap size={12} />5h残</span>
        <span className="chip__value">{formatRemaining(limits?.fiveHour)}</span>
      </div>
      <div className="chip" data-selected={scope === "weekly"} data-warn={limits?.weekly != null && limits.weekly.remainingPercent <= 15} title={limitTooltip(limits, limits?.weekly)}>
        <span className="chip__lead"><ChartNoAxesColumnIncreasing size={12} />週残</span>
        <span className="chip__value">{formatRemaining(limits?.weekly)}</span>
      </div>
      <div className="chip" title={`${scopeLabel}枠のリセット ${formatResetAt(resetAt)}`}>
        <span className="chip__lead"><TimerReset size={12} />{scopeLabel}回復</span>
        <span className="chip__value">{formatResetCountdown(resetAt, now)}</span>
      </div>
    </motion.section>
  );
}
