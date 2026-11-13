# AGENTS.md

## Project Overview
- This repository contains `LimitView`, a local desktop subscription quota viewer. Codex and Claude Code are the defaults; Z.AI, Kimi Code, Command Code, OpenCode Go, Antigravity CLI, GitHub Copilot, and Cursor can be selected through the bundled OpenUsage (see 仕様.md for conditions).
- The frontend is a React 18 + TypeScript app built with Vite; the titlebar displays `LimitView`.
- The desktop shell/backend is Tauri v2 with Rust. Quotas come from Codex app-server and bundled OpenUsage; there is no local usage database, process monitoring, manual quota input, or token estimation.
- User-facing UI text is currently Japanese. Keep technical identifiers, command names, and API names in English.

## Key Commands
- `npm run build`: run `tsc` and build the frontend into `dist/`.
- `npm run test`: run Vitest once.
- `npm run tauri dev`: run the Tauri desktop app in development mode.
- `npm run tauri build`: build the Tauri app; the configured bundle target is `nsis`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1`: build the signed installer, `latest.json`, and checksums for a GitHub Release; requires the updater key outside the repository (see README.md).
- `cargo test`: run Rust tests from `src-tauri/`. Run `npm run pretauri` once before running it directly, because it builds the bundled `openusage.exe`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-prepare-openusage.ps1`: verify OpenUsage preparation with isolated fixtures and no network.

## Repository Structure
- `src/App.tsx`: main dashboard orchestration, per-provider quota polling, display settings load/save, minimal-mode sizing, and five-hour/weekly/standard scope switching.
- `src/ManaRing.tsx`: animated 1-3 ring MANA visualization; the selected provider is the outer ring and the others are inner rings. Default colors are Codex blue and Claude orange; users can override colors per provider.
- `src/contextMenu.ts`: native right-click menu items (Tauri `Menu.popup`); `App.tsx` owns the `contextmenu` listener, the always-on-top state, and the actions.
- `src/AppOptions.tsx`: options panel split into ring (count, providers, colors), display (initial scope, minimal ring size), and app (version, updates, release page, settings reset) tabs.
- `src/providers.ts`: provider catalog (labels, default colors, notes), `DisplaySettings` defaults/normalization, and window selection per scope.
- `src/quotaRefresh.ts`: refresh intervals, rate-limit backoff, and keeping the last successful quota on transient errors.
- `src/LimitsSettings.tsx`: retrieval details panel opened by the titlebar activity (waveform) button; no manual input or record editing.
- `src/ringSize.ts`: minimal-mode ring size setting (`ringScale`) normalization and ring/window pixel sizes.
- `src-tauri/src/live_limits.rs`: `get_provider_limits`, Codex discovery and app-server RPC, OpenUsage execution, Claude parsing/error classification, and Claude auth recovery serialization.
- `src-tauri/src/subscription_limits.rs`: OpenUsage snapshot parsing for the additional providers; only explicit subscription gauges are admitted.
- `src-tauri/src/claude_auth.rs`: Claude Code CLI discovery and the hidden `/exit` auth refresh.
- `src-tauri/src/display_settings.rs`: fixed-file, fixed-key persistence of display settings via the Rust Store API.
- `src-tauri/src/app_updates.rs`: update check/install (single install per process) and release page commands.
- `src-tauri/src/process.rs`: hidden child process creation and Windows Job Object lifetime management via process-wrap for Codex, OpenUsage, and Claude Code.
- `scripts/prepare-openusage.ps1`: downloads the pinned OpenUsage source and Zig, extracts them fresh into `.openusage-build/work/` for every build, applies the anchored source edits listed in `$edits` plus the `scripts/openusage/*.go` overlays (registered in `$overlays`), runs their `TestLimitView*` tests, and builds `src-tauri/binaries/openusage.exe`; runs automatically as `npm run pretauri`. Build inputs and caches live in `.openusage-build/` (ignored).
- `src-tauri/icons/app-icon.png`: selected dual-ring app icon master. Use the existing Tauri CLI `icon` command to generate `icon.ico` and `32x32.png`; the latter is shared by the titlebar and browser favicon.

## Coding Conventions
- Keep TypeScript strict and avoid `any`; update `src/types.ts` when changing serialized command payloads or responses.
- Tauri command payloads use `camelCase` across the frontend boundary via Serde; Rust internal fields are `snake_case`.
- Keep `LiveProviderLimits`, `LiveLimitWindow`, and `SubscriptionWindow` in TypeScript aligned with Rust serialization. Frontend quota state is `ProviderQuotaMap` (a provider is absent or `null` until its first retrieval). UI scope keys are `fiveHour`, `weekly`, and `standard`.
- `get_provider_limits` accepts one `ToolKind` id (`codex`, `claude_code`, `zai`, `kimi_cli`, `command_code`, `opencode`, `antigravity`, `copilot`, `cursor`) and returns one provider. When adding a provider, update the Rust `Provider` enum, the Go filter allowlist in `scripts/openusage/limitview_filter.go`, `ToolKind`, `PROVIDERS`, and `REFRESH_INTERVAL`. Keep polling guards independent and apply each result immediately.
- Keep process-wrap's `KillOnDrop`, `CreationFlags(CREATE_NO_WINDOW)`, and `JobObject` together. Do not unwrap the child or bypass its job ownership. Bound all pipe I/O with the provider deadline.
- When adding or renaming a Tauri command, update all three places: Rust command function, `tauri::generate_handler!`, and `src/api.ts`.
- Do not grant `store:*` or other filesystem-reaching plugin permissions to the frontend; the Store plugin accepts arbitrary paths. Add a fixed Rust command instead. Keep the production CSP in `tauri.conf.json` (`devCsp` stays `null` for Vite HMR) and keep `script-src` without inline scripts.
- App updates run only through the Rust commands in `src-tauri/src/app_updates.rs`; do not grant `updater:*` capabilities to the frontend. Check and install only on explicit button presses. Never commit the updater private key or its password, and keep the `pubkey` in `tauri.conf.json` unless the key is intentionally rotated.
- Do not reintroduce manual quotas or local token/time estimates as subscription quota data. Missing provider windows display `—`.
- Frontend UI is compact and desktop-window oriented. Preserve the dark transparent MANA HUD, circular ring hierarchy, large selected quota, default blue Codex/orange Claude color roles, and inline rows with shared separators. Keep normal mode usable at 400x380 and its minimum 360x340.
- Use `framer-motion` for existing ring/chip motion patterns instead of introducing another animation library.
- For custom window controls, call `getCurrentWindow()` from `@tauri-apps/api/window`; avoid native browser window assumptions.
- The native window shadow stays off (`shadow: false` in `tauri.conf.json`) in both modes. On Windows an undecorated shadowed window gets a DWM 1px border and rounded outline around the whole transparent rectangle, which shows as a faint frame outside the HUD; the HUD border comes from CSS only.
- Minimal mode takes window/ring sizes only from `src/ringSize.ts` (`ringScale`, default 50 → 200x200, ring layout zoomed via `--minimal-zoom`), sets always-on-top, removes the ring core fill, and hides chip rails/titlebar. Restore core fill in normal mode. Keep minimal-mode controls reachable and avoid text-heavy UI there. Size mapping per `ringScale`: 仕様.md「概要」のミニマル表示の段落 → read when changing ring sizes.
- Use existing React Testing Library and Vitest patterns for frontend behavior tests.
- Use concise Rust error strings returned as `Result<_, String>` from Tauri commands.
- Use only provider-reported percentages and reset timestamps. Quota retrieval errors must show safe classified messages; never expose raw diagnostics, credentials, or account identifiers.
- Keep the scope toggle (five-hour/weekly, plus standard when a selected provider has other periods) reachable through the reading and scope button in normal and minimal modes. All service icon buttons remain visible; clicking one or using the wheel selects the outer ring and central percentage without changing scope. Keep selection in a single state and do not nest buttons.

## Testing And Validation
- For frontend or TypeScript changes, run `npm run test` and `npm run build`.
- For Rust backend or quota retrieval changes, run `cargo test` from `src-tauri/`.
- For full desktop integration changes, run `npm run tauri dev` and verify the transparent undecorated window, titlebar drag/buttons, ring animation, and minimal-mode enter/exit manually.
- Keep tests focused on scope switching, live quota rendering, missing data, retrieval details, reset formatting, and window API calls; verify provider parsing and executable discovery in Rust tests.
- The ignored live quota test requires authenticated providers and network access; run `cargo test live_quotas_without_codex_in_path -- --ignored --test-threads=1`. Tests named `descendant_fixture` and `pipe_holder_fixture` are subprocess helpers, not standalone validation.
- To verify installed npm Codex compatibility, run `cargo test live_quotas_from_npm_native_cli -- --ignored --test-threads=1` with npm Codex installed and authenticated. Use `app-server --listen stdio://`; the shorter `--stdio` alias is not available in all CLI releases.

## Agent Workflow Notes
- Check `git status --short` before editing and do not revert unrelated user changes.
- Do not edit generated/build outputs unless explicitly requested: `dist/`, `node_modules/`, `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/binaries/openusage.exe`, and `.openusage-build/`.
- Local database files (`*.db`, `*.db-shm`, `*.db-wal`) are ignored and should not be committed.
- The old `ai-limitusage-watcher.db` is retained on existing installations for data preservation only. The app does not open, migrate, or delete it.
- Keep the application identifier `com.local.ai-limitusage-watcher` and internal executable name for compatibility. NSIS uses the product name to detect installed versions, so users must uninstall the old `AI LimitUsage Watcher` without deleting app data before installing `LimitView`; see README.md.
- `.claude/settings.local.json` is a local Claude Code permissions file. Do not treat it as application source unless the user explicitly asks to change Claude Code workspace settings.
- `package-lock.json` is present, so use npm commands unless the user asks to change package tooling.
