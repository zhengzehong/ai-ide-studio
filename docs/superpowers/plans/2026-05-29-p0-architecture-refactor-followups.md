# P0 Architecture Refactor Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the push-blocking review findings from the four architecture refactor commits without changing runtime behavior.

**Architecture:** Keep changes surgical: one formatting cleanup, one test title fix, one unused helper removal, and documentation updates that describe the new module boundaries. Do not continue larger Workspace/ACP refactors in this task.

**Tech Stack:** TypeScript, React, SQLite/better-sqlite3, Markdown documentation, Git validation commands.

---

### Task 1: Code hygiene fixes

**Files:**
- Modify: `src/acp/client-handler.ts`
- Modify: `tests/integration/sqlite-migration.test.ts`
- Modify: `src/gateway/rpc/subscriptions.ts`

- [ ] Remove the extra blank line at EOF in `src/acp/client-handler.ts` so `git diff --check` no longer reports `new blank line at EOF`.
- [ ] Rename the garbled SQLite migration test title to `创建工具上下文、工具调用审计和 schema_migrations 表`.
- [ ] Delete the unused `emitSessionEvent()` export from `src/gateway/rpc/subscriptions.ts` and remove its unused `events` import.
- [ ] Run `git diff --check origin/master..HEAD` and confirm there are no whitespace errors.

### Task 2: Architecture documentation sync

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`

- [ ] Update `overview.md` so it names `src/gateway/rpc/*`, `src/acp/client-handler.ts`, `src/acp/host-state.ts`, `src/acp/interaction-state.ts`, `src/acp/session-capabilities.ts`, `src/acp/terminal-bridge.ts`, and `src/store/migrations/*` as current architecture pieces.
- [ ] Remove garbled text blocks from `overview.md`, replacing them with readable Chinese descriptions of project-level agents and ACP lazy lifecycle.
- [ ] Update `ws-protocol.md` with readable Chinese descriptions for project Agent RPCs and remove garbled text.
- [ ] Update `data-model.md` with readable Chinese descriptions for project Agent extensions and migration ownership; remove garbled text.

### Task 3: Verification

**Files:**
- No code changes unless verification exposes a direct issue in Task 1 or Task 2.

- [ ] Run `npm run lint`.
- [ ] Run backend typecheck: `npx tsc -p tsconfig.server.json --noEmit`.
- [ ] Run UI typecheck without build info writes if normal UI build is blocked: `cd ui && npx tsc -p tsconfig.app.json --noEmit --incremental false` and `cd ui && npx tsc -p tsconfig.node.json --noEmit --incremental false`.
- [ ] Try `npm test` and `npm run build`; if blocked by local EPERM file locks, report the exact blocker instead of claiming success.
