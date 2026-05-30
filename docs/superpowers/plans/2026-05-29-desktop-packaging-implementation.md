# Desktop Packaging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the desktop-packaging foundation so the app can run as a single backend-served Web app and has a clean lifecycle boundary for Electron.

**Architecture:** Keep Electron-specific code minimal and optional. First make the shared backend lifecycle explicit, serve `ui/dist` from the backend in production, and make the frontend infer its WebSocket URL from `window.location`; then add lightweight Electron entry/config files without moving business logic into Electron.

**Tech Stack:** TypeScript, Hono, @hono/node-server, ws, React/Vite, Electron/electron-builder configuration.

---

### Task 1: Backend lifecycle and config boundary

**Files:**
- Create: `src/app.ts`
- Modify: `src/entry.ts`
- Modify: `src/core/config.ts`

- [ ] Add `host`, `runtime`, `localToken`, and `staticDir` to `AppConfig`.
- [ ] Add `startApp(config)` in `src/app.ts` that initializes DB, seeds defaults, starts Gateway and Rule Engine, and returns `stop()`.
- [ ] Make `src/entry.ts` a thin CLI/Web launcher that calls `startApp(loadConfig())` and handles SIGINT/SIGTERM.

### Task 2: Static asset hosting and local token guard

**Files:**
- Create: `src/gateway/static-assets.ts`
- Modify: `src/gateway/server.ts`

- [ ] Add production static asset middleware for `ui/dist` with SPA fallback.
- [ ] Add minimal Electron local token guard for HTTP requests when `AI_IDE_LOCAL_TOKEN` is set.
- [ ] Pass `host` into `serve()` so Electron can bind to `127.0.0.1`.

### Task 3: Frontend WebSocket URL derivation

**Files:**
- Modify: `ui/src/stores/connection.store.ts`
- Create: `ui/src/stores/connection.store.test.ts` is not available in current test setup, so add pure helper in same module and cover indirectly by typecheck/lint.

- [ ] Replace hardcoded `ws://localhost:18800` with a helper that uses `VITE_WS_URL`, then `VITE_WS_PORT`, then `window.location`.

### Task 4: Runtime resolver and Electron skeleton

**Files:**
- Modify: `src/acp/runtime-registry.ts`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/builder.config.ts`
- Modify: `package.json`

- [ ] Add Electron resources lookup to ACP runtime resolver before local `node_modules/.bin`.
- [ ] Add Electron main process skeleton that starts backend as a child process and opens the local URL.
- [ ] Add package scripts and devDependencies for Electron packaging.

### Task 5: Verification

**Files:**
- No code changes unless direct verification issue appears.

- [ ] Run `npm run lint`.
- [ ] Run `npx tsc -p tsconfig.server.json --noEmit`.
- [ ] Run `cd ui && npx tsc -p tsconfig.app.json --noEmit --incremental false`.
- [ ] Run `npm test` and `npm run build`; if blocked by local EPERM locks, report exact blocker.
