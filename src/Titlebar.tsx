import { Minimize2, Minus, RefreshCw, Settings, X } from "lucide-react";
import appIcon from "../src-tauri/icons/32x32.png";
import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitlebarProps {
  onReload: () => void;
  onSettings: () => void;
  onMinimal: () => void;
  settingsOpen: boolean;
  syncedAt?: string | null;
  refreshing: boolean;
}

export function Titlebar({ onReload, onSettings, onMinimal, settingsOpen, syncedAt, refreshing }: TitlebarProps) {
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
        <img className="titlebar__icon" src={appIcon} width={16} height={16} alt="" draggable={false} />
        <span>LimitView</span>
        {syncedAt ? <span className="titlebar__sync">· {syncedAt}</span> : null}
      </div>

      <div className="titlebar__actions">
        <button
          aria-label="再読み込み"
          className="titlebar__btn"
          onClick={onReload}
          disabled={refreshing}
          type="button"
        >
          <RefreshCw size={13} />
        </button>
        <button
          aria-label={settingsOpen ? "取得状況を閉じる" : "取得状況"}
          aria-pressed={settingsOpen}
          className={`titlebar__btn${settingsOpen ? " active" : ""}`}
          onClick={onSettings}
          type="button"
        >
          <Settings size={13} />
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
