import { motion } from "framer-motion";
import { Maximize2, Sparkles } from "lucide-react";
import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ManaRingProps {
  codexRemainingPercent: number;
  claudeRemainingPercent: number;
  planLabel: string;
  onCyclePlan: () => void;
  minimal?: boolean;
  onExitMinimal?: () => void;
}

const SIZE = 200;
const CENTER = SIZE / 2;

const OUTER_R = 86;
const OUTER_W = 16;
const INNER_R = 58;
const INNER_W = 14;

const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_C = 2 * Math.PI * INNER_R;

const WARN_THRESHOLD = 15;

export function ManaRing({
  codexRemainingPercent,
  claudeRemainingPercent,
  planLabel,
  onCyclePlan,
  minimal = false,
  onExitMinimal,
}: ManaRingProps) {
  const claudePct = clamp(claudeRemainingPercent);
  const codexPct = clamp(codexRemainingPercent);
  const claudeOffset = OUTER_C * (1 - claudePct / 100);
  const codexOffset = INNER_C * (1 - codexPct / 100);
  const claudeWarn = claudePct <= WARN_THRESHOLD;
  const codexWarn = codexPct <= WARN_THRESHOLD;

  const handleRimDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!minimal) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div
      className={`manaRing${minimal ? " manaRing--minimal" : ""}`}
      aria-label="Mana 残量"
      onMouseDown={handleRimDrag}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img">
        <defs>
          <linearGradient id="claudeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--claude-1)" />
            <stop offset="100%" stopColor="var(--claude-2)" />
          </linearGradient>
          <linearGradient id="codexGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--codex-1)" />
            <stop offset="100%" stopColor="var(--codex-2)" />
          </linearGradient>
          <filter id="claudeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="codexGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {/* Claude (outer) track */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={OUTER_R}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={OUTER_W}
          />
          {/* Claude arc */}
          <motion.circle
            cx={CENTER}
            cy={CENTER}
            r={OUTER_R}
            fill="none"
            stroke="url(#claudeGrad)"
            strokeWidth={OUTER_W}
            strokeLinecap="round"
            strokeDasharray={OUTER_C}
            initial={{ strokeDashoffset: OUTER_C }}
            animate={{ strokeDashoffset: claudeOffset }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            filter="url(#claudeGlow)"
          />
          {claudeWarn ? (
            <motion.circle
              cx={CENTER}
              cy={CENTER}
              r={OUTER_R}
              fill="none"
              stroke="url(#claudeGrad)"
              strokeWidth={OUTER_W + 4}
              strokeLinecap="round"
              strokeDasharray={OUTER_C}
              strokeDashoffset={claudeOffset}
              opacity={0.35}
              animate={{ opacity: [0.2, 0.55, 0.2] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}

          {/* Codex (inner) track */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={INNER_R}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={INNER_W}
          />
          {/* Codex arc */}
          <motion.circle
            cx={CENTER}
            cy={CENTER}
            r={INNER_R}
            fill="none"
            stroke="url(#codexGrad)"
            strokeWidth={INNER_W}
            strokeLinecap="round"
            strokeDasharray={INNER_C}
            initial={{ strokeDashoffset: INNER_C }}
            animate={{ strokeDashoffset: codexOffset }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            filter="url(#codexGlow)"
          />
          {codexWarn ? (
            <motion.circle
              cx={CENTER}
              cy={CENTER}
              r={INNER_R}
              fill="none"
              stroke="url(#codexGrad)"
              strokeWidth={INNER_W + 4}
              strokeLinecap="round"
              strokeDasharray={INNER_C}
              strokeDashoffset={codexOffset}
              opacity={0.35}
              animate={{ opacity: [0.2, 0.55, 0.2] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
        </g>
      </svg>

      <button
        type="button"
        className="manaRing__center manaRing__center--tap"
        onClick={onCyclePlan}
        aria-label={`プラン切替 (現在 ${planLabel})`}
        title="クリックでプラン切替"
      >
        <span className="manaRing__title">
          <Sparkles size={11} />
          MANA
        </span>
        <span className="manaRing__row claude">
          <span>CC</span>
          <strong>{Math.round(claudePct)}%</strong>
        </span>
        <span className="manaRing__row codex">
          <span>CX</span>
          <strong>{Math.round(codexPct)}%</strong>
        </span>
        <span className="manaRing__plan">{planLabel}</span>
      </button>

      {minimal && onExitMinimal ? (
        <button
          type="button"
          className="manaRing__exitMinimal"
          onClick={onExitMinimal}
          aria-label="通常モードに戻す"
          title="通常モードに戻す"
        >
          <Maximize2 size={12} />
        </button>
      ) : null}
    </div>
  );
}

function clamp(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
