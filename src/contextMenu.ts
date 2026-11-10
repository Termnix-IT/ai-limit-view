import { Menu } from "@tauri-apps/api/menu";
import type { MenuOptions } from "@tauri-apps/api/menu";
import { PROVIDERS, scopeLabel } from "./providers";
import type { LimitScope, ToolKind } from "./types";

export interface ContextMenuState {
  minimal: boolean;
  pinned: boolean;
  canReload: boolean;
  scope: LimitScope;
  scopes: LimitScope[];
  providers: ToolKind[];
  activeTool: ToolKind;
}

export interface ContextMenuActions {
  toggleMinimal: () => void;
  togglePinned: () => void;
  reload: () => void;
  selectScope: (scope: LimitScope) => void;
  selectTool: (tool: ToolKind) => void;
  openLimits: () => void;
  openOptions: () => void;
  minimize: () => void;
  close: () => void;
}

type MenuItems = NonNullable<MenuOptions["items"]>;

/** Plain item descriptions, so the menu content can be tested without the Tauri runtime. */
export function contextMenuItems(state: ContextMenuState, actions: ContextMenuActions): MenuItems {
  return [
    { text: state.minimal ? "通常モードに戻す" : "ミニマル化", action: actions.toggleMinimal },
    { text: "最前面に固定", checked: state.pinned, action: actions.togglePinned },
    { text: "再読み込み", enabled: state.canReload, action: actions.reload },
    { item: "Separator" },
    { text: "表示枠", items: state.scopes.map((scope) => ({ text: scopeLabel(scope),
      checked: scope === state.scope, action: () => actions.selectScope(scope) })) },
    { text: "外側のサービス", items: state.providers.map((id) => ({ text: PROVIDERS[id].label,
      checked: id === state.activeTool, action: () => actions.selectTool(id) })) },
    { item: "Separator" },
    { text: "取得状況", action: actions.openLimits },
    { text: "オプション", action: actions.openOptions },
    { item: "Separator" },
    { text: "最小化", action: actions.minimize },
    { text: "閉じる", action: actions.close },
  ];
}

let openMenu: Menu | null = null;

/** Shows the menu at the cursor. The previous menu's native resource is released first. */
export async function showContextMenu(state: ContextMenuState, actions: ContextMenuActions) {
  const previous = openMenu;
  openMenu = null;
  if (previous) await previous.close().catch(() => {});
  const menu = await Menu.new({ items: contextMenuItems(state, actions) });
  openMenu = menu;
  await menu.popup();
}
