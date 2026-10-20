import { motion, useReducedMotion } from "framer-motion";
import { Clock3, Maximize2, Sparkles, TriangleAlert } from "lucide-react";
import type { MouseEvent, WheelEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ServiceMark } from "./ServiceMark";
import { PROVIDERS, providerStyle, providerVariant, scopeLabel, selectedWindow } from "./providers";
import type { DisplaySettings, LimitScope, ProviderQuotaMap, ToolKind } from "./types";

interface ManaRingProps {
  providers: ToolKind[];
  limits: ProviderQuotaMap;
  colors: DisplaySettings["colors"];
  activeTool: ToolKind;
  scope: LimitScope;
  onToggleScope: () => void;
  onSwitchTool: (tool: ToolKind) => void;
  minimal?: boolean;
  staleMessage?: string | null;
  onExitMinimal?: () => void;
}

export function ManaRing({ providers, limits, colors, activeTool, scope, onToggleScope, onSwitchTool,
  minimal = false, onExitMinimal, staleMessage = null }: ManaRingProps) {
  const active = selectedWindow(limits[activeTool], scope);
  const activePercent = active?.remainingPercent ?? null;
  const activeLabel = PROVIDERS[activeTool].label;
  const label = scope === "standard" ? active?.label ?? "サービス標準" : scopeLabel(scope);
  const variant = providerVariant(activeTool);
  const percentageLabel = (value: number | null) => value === null ? "未取得" : `${Math.round(clamp(value))}%`;
  const ordered = [activeTool, ...providers.filter((id) => id !== activeTool)];
  const accessibleOrder = providers.length === 2 && providers.includes("codex") && providers.includes("claude_code")
    ? ["claude_code", "codex"] as const : providers;
  const summary = accessibleOrder.map((id) => `${PROVIDERS[id].label} ${percentageLabel(selectedWindow(limits[id], scope)?.remainingPercent ?? null)}`).join("、");
  const handleRimDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (!minimal || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.deltaY) return;
    const index = providers.indexOf(activeTool);
    onSwitchTool(providers[(index + (event.deltaY > 0 ? 1 : providers.length - 1)) % providers.length]);
  };
  return (
    <div className={`manaRing ${variant}${minimal ? " manaRing--minimal" : ""}`} data-count={providers.length}
      style={providerStyle(activeTool, colors[activeTool])} aria-label={`Mana ${label}枠の残量`} onMouseDown={handleRimDrag}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${label}枠：${summary}、外側 ${activeLabel}`}>
        <defs>
          {providers.map((id) => {
            const style = providerStyle(id, colors[id]) as Record<string, string>;
            return <linearGradient key={id} id={`${providerVariant(id)}Grad`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={style["--ring-start"]} /><stop offset="100%" stopColor={style["--ring-end"]} />
            </linearGradient>;
          })}
          <radialGradient id="manaCore"><stop offset="0%" stopColor="var(--service-soft)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#101c2f" stopOpacity="0.2" /></radialGradient>
          {providers.map((id) => <filter key={id} id={`${providerVariant(id)}Glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={providers.length === 3 ? "1.5" : "2.5"} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>)}
        </defs>
        <g className="manaRing__instrument" aria-hidden="true" fill="none">
          <circle cx="100" cy="100" r="98" stroke="var(--codex-soft)" strokeWidth="0.5" />
          <circle cx="100" cy="100" r="94" stroke="var(--codex-2)" strokeWidth="0.5" strokeDasharray="1 9" opacity="0.45" />
          {Array.from({ length: 24 }, (_, index) => <path key={index} d={index % 6 === 0 ? "M100 0v5" : "M100 1v2"}
            transform={`rotate(${index * 15} 100 100)`} stroke="var(--codex-2)" strokeWidth="0.6" opacity="0.5" />)}
          <circle cx="100" cy="100" r={providers.length === 3 ? 53 : 60} fill={minimal ? "none" : "url(#manaCore)"} stroke="var(--service-soft)" strokeWidth="0.7" />
          <path d="M37 100h5m116 0h5" stroke="var(--service-color)" strokeWidth="0.8" />
        </g>
        <g transform="rotate(-90 100 100)">{ordered.map((id, index) => <QuotaArc key={id} variant={providerVariant(id)}
          style={providerStyle(id, colors[id])} radius={providers.length === 3 ? [86, 72, 59][index] : [86, 70][index]}
          width={providers.length === 3 ? [10, 7, 6][index] : [12, 9][index]}
          remaining={selectedWindow(limits[id], scope)?.remainingPercent ?? null} />)}</g>
      </svg>
      <div className="manaRing__center" data-unknown={activePercent === null} onWheel={handleWheel}>
        <button type="button" className="manaRing__readout" onClick={onToggleScope}
          aria-label={`残量枠切替 (現在 ${label} / ${activeLabel})${staleMessage ? " · 前回の取得値（更新失敗）" : ""}`}
          title={staleMessage ?? "クリックで表示枠切替 · ホイールでサービス切替"}>
          <span className="manaRing__title"><Sparkles size={12} aria-hidden="true" />MANA</span>
          <strong className="manaRing__value">{activePercent === null ? "—" : <>{Math.round(clamp(activePercent))}<span>%</span></>}
            {staleMessage && activePercent !== null ? <span className="manaRing__stale" aria-hidden="true"><TriangleAlert size={10} /></span> : null}
          </strong>
        </button>
        <div className="manaRing__services" role="group" aria-label="外側リングのサービス">
          {providers.map((id) => <button key={id} type="button" className={`manaRing__serviceButton ${providerVariant(id)}`}
            style={providerStyle(id, colors[id])} aria-label={`${PROVIDERS[id].label}を外側に表示`} aria-pressed={activeTool === id}
            title={`${PROVIDERS[id].label}のリングと残量を選択`} onClick={() => onSwitchTool(id)}>
            <ServiceMark variant={providerVariant(id)} mark={PROVIDERS[id].mark} />
          </button>)}
        </div>
        <button type="button" className="manaRing__scope" onClick={onToggleScope} title="クリックで表示枠切替">
          <Clock3 size={10} aria-hidden="true" />{label}枠
        </button>
      </div>
      {minimal && onExitMinimal ? <button type="button" className="manaRing__exitMinimal" onClick={onExitMinimal}
        aria-label="通常モードに戻す" title="通常モードに戻す"><Maximize2 size={12} aria-hidden="true" /></button> : null}
    </div>
  );
}

function QuotaArc({ variant, radius, width, remaining, style }: {
  variant: string; radius: number; width: number; remaining: number | null; style: React.CSSProperties;
}) {
  const reducedMotion = useReducedMotion();
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(remaining ?? 0) / 100);
  const warn = remaining !== null && remaining > 0 && remaining <= 15;
  return <g style={style}>
    <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--service-soft)" strokeWidth={width} opacity="0.6" />
    {remaining !== null && remaining > 0 ? <motion.circle className="manaRing__arc" cx="100" cy="100" r={radius}
      fill="none" stroke={`url(#${variant}Grad)`} strokeWidth={width} strokeLinecap="round" strokeDasharray={circumference}
      initial={reducedMotion ? false : { strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }}
      transition={{ duration: reducedMotion ? 0 : 0.6, ease: "easeOut" }} filter={`url(#${variant}Glow)`} /> : null}
    {warn && !reducedMotion ? <motion.circle cx="100" cy="100" r={radius} fill="none" stroke={`url(#${variant}Grad)`}
      strokeWidth={width + 3} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
      animate={{ opacity: [0.15, 0.4, 0.15] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} /> : null}
  </g>;
}
function clamp(value: number): number { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0; }
