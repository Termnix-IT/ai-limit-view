import { motion } from "framer-motion";
import { BatteryCharging, Swords, Zap } from "lucide-react";
import { formatDateTime } from "./date";
import type { ToolDashboard } from "./types";

interface ToolChipRailProps {
  variant: "codex" | "claude";
  tool: ToolDashboard;
  output: { value: string; tooltip: string; intensity: "calm" | "steady" | "hot" };
  recharge: { value: string; tooltip: string; warn: boolean };
  status: { value: string; tooltip: string; running: boolean };
  tierLabel: string;
}

const TITLE: Record<"codex" | "claude", string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function ToolChipRail({
  variant,
  tool,
  output,
  recharge,
  status,
  tierLabel,
}: ToolChipRailProps) {
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
        <h2 className="chipRail__title">
          <span className="dot" aria-hidden="true" />
          {TITLE[variant]}
        </h2>
        <span className="tierBadge" title={`Tier: ${tierLabel}`}>
          {tierLabel}
        </span>
      </div>

      <div className="chip" title={output.tooltip}>
        <span className="chip__lead">
          <Zap size={12} />
          出力
        </span>
        <span className="chip__value">{output.value}</span>
      </div>

      <div className="chip" data-warn={recharge.warn} title={recharge.tooltip}>
        <span className="chip__lead">
          <BatteryCharging size={12} />
          リチャージ
        </span>
        <span className="chip__value">{recharge.value}</span>
      </div>

      <div className="chip" title={`${status.tooltip}\n最終使用 ${formatDateTime(tool.lastUsedAt)}`}>
        <span className="chip__lead">
          <Swords size={12} />
          {status.running ? "稼働中" : "待機中"}
        </span>
        <span className="chip__value">{status.value}</span>
      </div>
    </motion.section>
  );
}
