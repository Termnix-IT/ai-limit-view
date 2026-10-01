import { motion, useReducedMotion } from "framer-motion";
import { Clock3, Maximize2, Sparkles, TriangleAlert } from "lucide-react";
import type { MouseEvent, WheelEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ServiceMark } from "./ServiceMark";
import type { LimitScope, ToolKind } from "./types";

interface ManaRingProps {
  codexRemainingPercent: number | null;
  claudeRemainingPercent: number | null;
  activeTool: ToolKind;
  scope: LimitScope;
  onToggleScope: () => void;
  onSwitchTool: (tool: ToolKind) => void;
  minimal?: boolean;
  staleMessage?: string | null;
  onExitMinimal?: () => void;
}

export function ManaRing({
  codexRemainingPercent, claudeRemainingPercent, activeTool, scope,
  onToggleScope, onSwitchTool, minimal = false, onExitMinimal, staleMessage = null,
}: ManaRingProps) {
  const activeLabel = activeTool === "codex" ? "Codex" : "Claude Code";
  const activePercent = activeTool === "codex" ? codexRemainingPercent : claudeRemainingPercent;
  const scopeLabel = scope === "fiveHour" ? "5時間" : "週間";
  const variant = activeTool === "codex" ? "codex" : "claude";
  const percentageLabel = (value: number | null) => value === null ? "未取得" : `${Math.round(clamp(value))}%`;

  const handleRimDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!minimal || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.deltaY !== 0) onSwitchTool(activeTool === "codex" ? "claude_code" : "codex");
  };

  return (
    <div className={`manaRing ${variant}${minimal ? " manaRing--minimal" : ""}`}
      aria-label={`Mana ${scopeLabel}枠の残量`} onMouseDown={handleRimDrag}>
      <svg viewBox="0 0 200 200" role="img"
        aria-label={`${scopeLabel}枠：Claude Code ${percentageLabel(claudeRemainingPercent)}、Codex ${percentageLabel(codexRemainingPercent)}、外側 ${activeLabel}`}>
        <defs>
          <linearGradient id="claudeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--claude-1)" />
            <stop offset="100%" stopColor="var(--claude-2)" />
          </linearGradient>
          <linearGradient id="codexGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--codex-1)" />
            <stop offset="100%" stopColor="var(--codex-2)" />
          </linearGradient>
          <radialGradient id="manaCore">
            <stop offset="0%" stopColor="var(--service-soft)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#101c2f" stopOpacity="0.2" />
          </radialGradient>
          {(["claude", "codex"] as const).map((name) => (
            <filter key={name} id={`${name}Glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
        </defs>
        <g className="manaRing__instrument" aria-hidden="true" fill="none">
          <circle cx="100" cy="100" r="98" stroke="var(--codex-soft)" strokeWidth="0.5" />
          <circle cx="100" cy="100" r="94" stroke="var(--codex-2)" strokeWidth="0.5" strokeDasharray="1 9" opacity="0.45" />
          {Array.from({ length: 24 }, (_, index) => (
            <path key={index} d={index % 6 === 0 ? "M100 0v5" : "M100 1v2"}
              transform={`rotate(${index * 15} 100 100)`} stroke="var(--codex-2)" strokeWidth="0.6" opacity="0.5" />
          ))}
          <circle cx="100" cy="100" r="60" fill={minimal ? "none" : "url(#manaCore)"} stroke="var(--service-soft)" strokeWidth="0.7" />
          <path d="M37 100h5m116 0h5" stroke="var(--service-color)" strokeWidth="0.8" />
        </g>
        <g transform="rotate(-90 100 100)">
          <QuotaArc variant="claude" radius={activeTool === "claude_code" ? 86 : 70}
            width={activeTool === "claude_code" ? 12 : 9} remaining={claudeRemainingPercent} />
          <QuotaArc variant="codex" radius={activeTool === "codex" ? 86 : 70}
            width={activeTool === "codex" ? 12 : 9} remaining={codexRemainingPercent} />
        </g>
      </svg>
      <div className="manaRing__center" data-unknown={activePercent === null} onWheel={handleWheel}>
        <button type="button" className="manaRing__readout" onClick={onToggleScope}
          aria-label={`残量枠切替 (現在 ${scopeLabel} / ${activeLabel})${staleMessage ? " · 前回の取得値（更新失敗）" : ""}`}
          title={staleMessage ?? "クリックで5時間枠 / 週間枠切替 · ホイールでサービス切替"}>
          <span className="manaRing__title"><Sparkles size={12} aria-hidden="true" />MANA</span>
          <strong className="manaRing__value">
            {activePercent === null ? "—" : <>{Math.round(clamp(activePercent))}<span>%</span></>}
            {staleMessage && activePercent !== null ? <span className="manaRing__stale" aria-hidden="true"><TriangleAlert size={10} /></span> : null}
          </strong>
        </button>
        <div className="manaRing__services" role="group" aria-label="外側リングのサービス">
          {(["codex", "claude_code"] as const).map((tool) => {
            const label = tool === "codex" ? "Codex" : "Claude Code";
            const serviceVariant = tool === "codex" ? "codex" : "claude";
            return (
              <button key={tool} type="button" className={`manaRing__serviceButton ${serviceVariant}`}
                aria-label={`${label}を外側に表示`} aria-pressed={activeTool === tool}
                title={`${label}のリングと残量を選択`} onClick={() => onSwitchTool(tool)}>
                <ServiceMark variant={serviceVariant} />
              </button>
            );
          })}
        </div>
        <button type="button" className="manaRing__scope" onClick={onToggleScope}
          title="クリックで5時間枠 / 週間枠切替">
          <Clock3 size={10} aria-hidden="true" />{scopeLabel}枠
        </button>
      </div>
      {minimal && onExitMinimal ? (
        <button type="button" className="manaRing__exitMinimal" onClick={onExitMinimal}
          aria-label="通常モードに戻す" title="通常モードに戻す">
          <Maximize2 size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function QuotaArc({ variant, radius, width, remaining }: {
  variant: "codex" | "claude";
  radius: number;
  width: number;
  remaining: number | null;
}) {
  const reducedMotion = useReducedMotion();
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(remaining ?? 0) / 100);
  const warn = remaining !== null && remaining > 0 && remaining <= 15;
  return (
    <>
      <circle cx="100" cy="100" r={radius} fill="none" stroke={`var(--${variant}-soft)`} strokeWidth={width} opacity="0.6" />
      {remaining !== null && remaining > 0 ? (
        <motion.circle className="manaRing__arc" cx="100" cy="100" r={radius} fill="none" stroke={`url(#${variant}Grad)`}
          strokeWidth={width} strokeLinecap="round" strokeDasharray={circumference}
          initial={reducedMotion ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }} transition={{ duration: reducedMotion ? 0 : 0.6, ease: "easeOut" }}
          filter={`url(#${variant}Glow)`} />
      ) : null}
      {warn && !reducedMotion ? (
        <motion.circle cx="100" cy="100" r={radius} fill="none" stroke={`url(#${variant}Grad)`}
          strokeWidth={width + 3} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          animate={{ opacity: [0.15, 0.4, 0.15] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
      ) : null}
    </>
  );
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
