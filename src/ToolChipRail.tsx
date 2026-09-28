import { motion } from "framer-motion";
import { useState } from "react";
import { BatteryCharging, TimerReset, Zap } from "lucide-react";
import { formatRemaining, formatResetAt, formatResetCountdown, limitTooltip, providerStatus } from "./limits";
import type { LimitScope, LiveProviderLimits } from "./types";

const TITLE = { codex: "Codex", claude: "Claude Code" } as const;

export function ToolChipRail({ variant, limits, scope, now }: {
  variant: "codex" | "claude";
  limits: LiveProviderLimits | null;
  scope: LimitScope;
  now: Date;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const failed = limits?.status === "unavailable";
  const activeWindow = limits?.[scope];
  const resetAt = activeWindow?.resetsAt;
  const scopeLabel = scope === "fiveHour" ? "5h" : "週";
  return (
    <motion.section
      className={`chipRail ${variant}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      aria-label={`${TITLE[variant]} 状況`}
    >
      <div className="chipRail__head">
        <h2 className="chipRail__title"><span className="dot" aria-hidden="true" />{TITLE[variant]}</h2>
        {failed ? (
          <button
            type="button"
            className="quotaBadge quotaBadge--error"
            title={limits.message ?? "残量を取得できません"}
            aria-label={`${TITLE[variant]} 残量取得の詳細`}
            aria-expanded={showDetails}
            onClick={() => setShowDetails((open) => !open)}
          >{providerStatus(limits)}</button>
        ) : (
          <span className="quotaBadge" title={limits?.source ?? "残量を取得中です"}>{providerStatus(limits)}</span>
        )}
      </div>
      {failed && showDetails ? <div className="quotaDetails" role="status">{limits.message}</div> : null}
      <div className="chip" data-selected={scope === "fiveHour"} title={limitTooltip(limits, limits?.fiveHour)}>
        <span className="chip__lead"><Zap size={12} />5h残</span>
        <span className="chip__value">{formatRemaining(limits?.fiveHour)}</span>
      </div>
      <div className="chip" data-selected={scope === "weekly"} data-warn={limits?.weekly != null && limits.weekly.remainingPercent <= 15} title={limitTooltip(limits, limits?.weekly)}>
        <span className="chip__lead"><BatteryCharging size={12} />週残</span>
        <span className="chip__value">{formatRemaining(limits?.weekly)}</span>
      </div>
      <div className="chip" title={`${scopeLabel}枠のリセット ${formatResetAt(resetAt)}`}>
        <span className="chip__lead"><TimerReset size={12} />{scopeLabel}回復</span>
        <span className="chip__value">{formatResetCountdown(resetAt, now)}</span>
      </div>
    </motion.section>
  );
}
