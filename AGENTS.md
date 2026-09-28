# AGENTS.md

## Project Overview
- This repository contains `AI LimitUsage Watcher`, a local desktop usage visibility app for Codex and Claude Code.
- The frontend is a React 18 + TypeScript app built with Vite. The current UI is a compact dark "MANA STATUS" dashboard with animated rings and chip rails.
- The desktop shell/backend is Tauri v2 with Rust. Quotas come from Codex app-server and bundled OpenUsage; there is no local usage database, process monitoring, manual quota input, or token estimation.
- The window is undecorated and transparent; custom titlebar controls live in React and use `@tauri-apps/api/window`.
- User-facing UI text is currently Japanese. Keep technical identifiers, command names, and API names in English.

## Key Commands
- `npm run dev`: start the Vite dev server on port `1420`.
- `npm run build`: run `tsc` and build the frontend into `dist/`.
- `npm run preview`: preview the built frontend.
- `npm run test`: run Vitest once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run tauri dev`: run the Tauri desktop app in development mode.
- `npm run tauri build`: build the Tauri app; the configured bundle target is `nsis`.
- `cargo test`: run Rust tests from `src-tauri/`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-prepare-openusage.ps1`: verify OpenUsage preparation with isolated fixtures and no network.

## Repository Structure
- `src/`: React frontend code, TypeScript types, API wrapper around Tauri commands, styles, and frontend tests.
- `src/App.tsx`: main dashboard orchestration, quota polling, minimal-mode sizing, five-hour/weekly scope switching, and dashboard orchestration.
- `src/ManaRing.tsx`: animated dual-ring MANA visualization; Claude is the outer orange ring and Codex is the inner blue ring.
- `src/ToolChipRail.tsx`: status rail for five-hour/weekly remaining quotas, retrieval status, and the selected scope reset countdown.
- `src/Titlebar.tsx`: custom Tauri titlebar, drag handling, reload, minimal mode, minimize, and close controls.
- `src/api.ts`: frontend-to-Tauri command names and payload wrappers.
- `src/types.ts`: shared TypeScript shapes expected from Tauri command serialization.
- `src/test/setup.ts`: Vitest/Jest DOM setup.
- `src/LimitsSettings.tsx`: retrieval details shown by the gear button; no manual input or record editing.
- `src/limits.ts`: shared quota status and reset time formatting.
- `src-tauri/`: Rust Tauri app and bundle config.
- `src-tauri/src/lib.rs`: minimal desktop setup and command registration.
- `src-tauri/src/live_limits.rs`: provider discovery, quota retrieval, safe diagnostics, and Rust tests.
- `src-tauri/src/process.rs`: hidden child process creation and Windows Job Object lifetime management via process-wrap for Codex and OpenUsage.
- `src-tauri/tauri.conf.json`: desktop window, dev server, build, and bundle settings; note `decorations: false` and `transparent: true`.

## Coding Conventions
- Keep TypeScript strict and avoid `any`; update `src/types.ts` when changing serialized command payloads or responses.
- Tauri command payloads use `camelCase` across the frontend boundary via Serde; Rust internal fields are `snake_case`.
- Keep `LiveProviderLimits` and `LiveLimitWindow` in TypeScript aligned with Rust serialization. `LiveLimits` is frontend state with nullable providers during first retrieval. UI scope keys are `fiveHour` and `weekly`.
- `get_provider_limits` accepts `codex` or `claude_code` and returns one provider. Keep polling guards independent and apply each result immediately.
- Keep process-wrap's `KillOnDrop`, `CreationFlags(CREATE_NO_WINDOW)`, and `JobObject` together. Do not unwrap the child or bypass its job ownership. Bound all pipe I/O with the provider deadline.
- When adding or renaming a Tauri command, update all three places: Rust command function, `tauri::generate_handler!`, and `src/api.ts`.
- Do not reintroduce manual quotas or local token/time estimates as subscription quota data. Missing provider windows display `—`.
- Frontend UI is compact and desktop-window oriented. Preserve the dark transparent MANA dashboard style, circular ring hierarchy, blue Codex/orange Claude color roles, and dense chip layout.
- Use `framer-motion` for existing ring/chip motion patterns instead of introducing another animation library.
- For custom window controls, call `getCurrentWindow()` from `@tauri-apps/api/window`; avoid native browser window assumptions.
- Minimal mode resizes the Tauri window to `200x200`, sets always-on-top, and hides chip rails/titlebar. Keep minimal-mode controls reachable and do not add text-heavy UI there.
- Use existing React Testing Library and Vitest patterns for frontend behavior tests.
- Use concise Rust error strings returned as `Result<_, String>` from Tauri commands.
- Use only provider-reported percentages and reset timestamps. Quota retrieval errors must show safe classified messages; never expose raw diagnostics, credentials, or account identifiers.
- Keep the five-hour/weekly scope toggle reachable in normal and minimal modes. The wheel changes the highlighted service without changing scope.

## Testing And Validation
- For frontend or TypeScript changes, run `npm run test` and `npm run build`.
- For Rust backend or quota retrieval changes, run `cargo test` from `src-tauri/`.
- For full desktop integration changes, run `npm run tauri dev` and verify the transparent undecorated window, titlebar drag/buttons, ring animation, and minimal-mode enter/exit manually.
- Keep tests focused on scope switching, live quota rendering, missing data, retrieval details, reset formatting, and window API calls; verify provider parsing and executable discovery in Rust tests.
- The ignored live quota test requires authenticated providers and network access; run `cargo test live_quotas_without_codex_in_path -- --ignored --test-threads=1`. Tests named `descendant_fixture` and `pipe_holder_fixture` are subprocess helpers, not standalone validation.
- To verify installed npm Codex compatibility, run `cargo test live_quotas_from_npm_native_cli -- --ignored --test-threads=1` with npm Codex installed and authenticated. Use `app-server --listen stdio://`; the shorter `--stdio` alias is not available in all CLI releases.

## Agent Workflow Notes
- Check `git status --short` before editing and do not revert unrelated user changes.
- Do not edit generated/build outputs unless explicitly requested: `dist/`, `node_modules/`, `src-tauri/target/`, and `src-tauri/gen/`.
- Local database files (`*.db`, `*.db-shm`, `*.db-wal`) are ignored and should not be committed.
- The old `ai-limitusage-watcher.db` is retained on existing installations for data preservation only. The app does not open, migrate, or delete it.
- `.claude/settings.local.json` is a local Claude Code permissions file. Do not treat it as application source unless the user explicitly asks to change Claude Code workspace settings.
- `package-lock.json` is present, so use npm commands unless the user asks to change package tooling.
