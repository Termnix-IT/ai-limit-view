# AGENTS.md

## Project Overview
- This repository contains `AI LimitUsage Watcher`, a local desktop usage visibility app for Codex and Claude Code.
- The frontend is a React 18 + TypeScript app built with Vite. The current UI is a compact dark "MANA STATUS" dashboard with animated rings and chip rails.
- The desktop shell/backend is Tauri v2 with Rust, SQLite storage through `rusqlite`, and process monitoring through Windows `tasklist`. Claude Code quota display is provisional and should not depend on heavy local transcript scans in the dashboard refresh path.
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

## Repository Structure
- `src/`: React frontend code, TypeScript types, API wrapper around Tauri commands, styles, and frontend tests.
- `src/App.tsx`: main dashboard orchestration, polling, minimal-mode sizing, plan cycling, and Codex/Claude chip data shaping.
- `src/ManaRing.tsx`: animated dual-ring MANA visualization; Claude is the outer orange ring and Codex is the inner blue ring.
- `src/ToolChipRail.tsx`: reusable status rail for output pace, recharge, and running/idle status.
- `src/Titlebar.tsx`: custom Tauri titlebar, drag handling, reload, minimal mode, minimize, and close controls.
- `src/api.ts`: frontend-to-Tauri command names and payload wrappers.
- `src/types.ts`: shared TypeScript shapes expected from Tauri command serialization.
- `src/test/setup.ts`: Vitest/Jest DOM setup.
- `src-tauri/`: Rust Tauri app, SQLite schema/migrations, command handlers, process scan logic, and bundle config.
- `src-tauri/src/lib.rs`: backend state, database migrations, Tauri commands, provisional Claude Code quota helpers, and Rust unit tests.
- `src-tauri/tauri.conf.json`: desktop window, dev server, build, and bundle settings; note `decorations: false` and `transparent: true`.

## Coding Conventions
- Keep TypeScript strict and avoid `any`; update `src/types.ts` when changing serialized command payloads or responses.
- Tauri command payloads use `camelCase` across the frontend boundary via Serde; Rust internal fields are `snake_case`.
- Keep `ToolKind` values aligned across TypeScript and Rust: `codex` and `claude_code`.
- Keep optional Claude quota fields aligned between Rust `ToolDashboard` and `src/types.ts`: `quotaSessionUsed`, `quotaSessionLimit`, `quotaSessionResetAt`, `quotaSessionWindowMinutes`, `quotaSessionStartedAt`, `quotaBurnRateTokensPerMin`, `quotaProjectedDepletionAt`, and `quotaPlan`.
- When adding or renaming a Tauri command, update all three places: Rust command function, `tauri::generate_handler!`, and `src/api.ts`.
- Keep SQLite schema changes inside `migrate` in `src-tauri/src/lib.rs`; preserve existing data when adding tables or columns.
- Frontend UI is compact and desktop-window oriented. Preserve the dark transparent MANA dashboard style, circular ring hierarchy, blue Codex/orange Claude color roles, and dense chip layout.
- Use `framer-motion` for existing ring/chip motion patterns instead of introducing another animation library.
- For custom window controls, call `getCurrentWindow()` from `@tauri-apps/api/window`; avoid native browser window assumptions.
- Minimal mode resizes the Tauri window to `200x200`, sets always-on-top, and hides chip rails/titlebar. Keep minimal-mode controls reachable and do not add text-heavy UI there.
- Use existing React Testing Library and Vitest patterns for frontend behavior tests.
- Use concise Rust error strings returned as `Result<_, String>` from Tauri commands.
- Claude Code quota estimation is approximate and temporary. Do not add dashboard-time recursive scans of `~/.claude/projects`; limit inference should eventually move to a separate repository/service.
- Do not present Claude Code quota numbers as official Anthropic usage unless the data comes from an official source. Current limits are local settings such as `claude_code_session_token_limit`, `claude_code_plan`, and `claude_code_burn_window_minutes`.
- Supported Claude plan values are `pro`, `max5`, `max20`, and `custom`; frontend plan cycling updates `claude_code_plan`.

## Testing And Validation
- For frontend or TypeScript changes, run `npm run test` and `npm run build`.
- For Rust backend, database, process monitoring, Claude transcript parsing, or quota changes, run `cargo test` from `src-tauri/`.
- For full desktop integration changes, run `npm run tauri dev` and verify the transparent undecorated window, titlebar drag/buttons, ring animation, and minimal-mode enter/exit manually.
- Keep tests focused on observable behavior: UI text, window API calls, command payloads, and quota rendering in frontend tests; database aggregation, migration, process scan, and Claude quota computation in Rust tests.

## Agent Workflow Notes
- Check `git status --short` before editing and do not revert unrelated user changes.
- Do not edit generated/build outputs unless explicitly requested: `dist/`, `node_modules/`, `src-tauri/target/`, and `src-tauri/gen/`.
- Local database files (`*.db`, `*.db-shm`, `*.db-wal`) are ignored and should not be committed.
- The app stores its runtime database under the Tauri app data directory as `ai-limitusage-watcher.db`; tests should prefer in-memory SQLite.
- `.claude/settings.local.json` is a local Claude Code permissions file. Do not treat it as application source unless the user explicitly asks to change Claude Code workspace settings.
- `package-lock.json` is present, so use npm commands unless the user asks to change package tooling.
