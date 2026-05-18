import { Gauge, Minus, RefreshCw, Settings, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitlebarProps {
  showSettings: boolean;
  onReload: () => void;
  onToggleSettings: () => void;
}

export function Titlebar({ showSettings, onReload, onToggleSettings }: TitlebarProps) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <Gauge size={12} />
        <span data-tauri-drag-region>AI LimitUsage Watcher</span>
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
        <button
          aria-label="設定"
          className={`titlebar__btn ${showSettings ? "active" : ""}`}
          onClick={onToggleSettings}
          type="button"
        >
          <Settings size={13} />
        </button>
        <span className="titlebar__divider" aria-hidden="true" />
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
