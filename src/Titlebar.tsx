import { Gauge, Minimize2, Minus, RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitlebarProps {
  onReload: () => void;
  onMinimal: () => void;
  syncedAt?: string | null;
}

export function Titlebar({ onReload, onMinimal, syncedAt }: TitlebarProps) {
  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest(".titlebar__actions")) return;
    void getCurrentWindow().startDragging();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest(".titlebar__actions")) return;
    void getCurrentWindow().toggleMaximize();
  };

  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      onMouseDown={handleDragStart}
      onDoubleClick={handleDoubleClick}
    >
      <div className="titlebar__brand">
        <Gauge size={12} />
        <span>MANA STATUS</span>
        {syncedAt ? <span className="titlebar__sync">· {syncedAt}</span> : null}
      </div>

      <div className="titlebar__actions">
        <button
          aria-label="再読み込み"
          className="titlebar__btn"
          onClick={onReload}
          type="button"
        >
          <RefreshCw size={13} />
        </button>
        <span className="titlebar__divider" aria-hidden="true" />
        <button
          aria-label="ミニマル化"
          className="titlebar__btn"
          onClick={onMinimal}
          type="button"
        >
          <Minimize2 size={13} />
        </button>
        <button
          aria-label="最小化"
          className="titlebar__btn"
          onClick={() => void getCurrentWindow().minimize()}
          type="button"
        >
          <Minus size={13} />
        </button>
        <button
          aria-label="閉じる"
          className="titlebar__btn danger"
          onClick={() => void getCurrentWindow().close()}
          type="button"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
