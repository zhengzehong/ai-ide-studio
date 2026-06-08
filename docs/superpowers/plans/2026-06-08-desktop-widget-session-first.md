# Desktop Widget Session-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop widget list active and unread sessions first, show lightweight conversation progress, and keep task creation/viewing aligned with real task statuses.

**Architecture:** Add a widget-specific session DTO on the backend so the floating window consumes small, stable data instead of inferring session state from agents. Reuse the Session runtime-state resolver for running state, keep unread state in `widget_read_state`, and let the frontend refresh a session list from widget RPC events. Keep Workspace as the full chat surface; the widget only opens the relevant session in the main window.

**Tech Stack:** Hono/ws RPC, better-sqlite3 stores, Electron IPC, React 19, Zustand, Vitest.

---

### Task 1: Backend Session DTO And Unread Semantics

**Files:**
- Modify: `src/gateway/rpc/widget.ts`
- Modify: `src/store/widget-state.ts`
- Test: `tests/integration/widget-rpc.test.ts`

- [x] Add tests for `widget.sessions.list` returning running sessions from persisted runtime state.
- [x] Add tests for completed unread sessions using latest agent message time versus `widget_read_state.read_at`.
- [x] Reuse `sessionStore.listWithRuntimeState` for Widget running state instead of Agent runtime status.
- [x] Implement `widget.sessions.list` by querying sessions by project, joining agent/project/task display data, and filtering to running or unread by default.
- [x] Implement `widget.sessions.markRead` with session existence validation.

### Task 2: Frontend Widget Store And Session Panel

**Files:**
- Modify: `ui/src/stores/widget.store.ts`
- Modify: `ui/src/pages/Widget.tsx`

- [x] Replace agent-list state with `sessions: WidgetSessionItem[]`.
- [x] Fetch sessions through `widget.sessions.list`.
- [x] Mark sessions read through `widget.sessions.markRead`.
- [x] Refresh sessions on `session:activity`, `session:done`, `session:changed`, and `agent:status`.
- [x] Render session rows with agent name, session/task title, project, stage, running/unread indicators, and time.

### Task 3: Task Panel Status Fixes

**Files:**
- Modify: `ui/src/pages/Widget.tsx`

- [x] Replace invalid `pending/in_progress` filters with real task groups: backlog and active.
- [x] Treat `executing`, `needs_input`, `reviewing`, and `blocked` as active.
- [x] Keep completed/cancelled visible only in the all filter.
- [x] Clear an invalid pinned agent when the selected project changes.

### Task 4: Electron Main-Window Navigation

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `ui/src/pages/Widget.tsx`
- Modify: `ui/src/pages/Workspace.tsx` if needed
- Modify: `ui/src/stores/session.store.ts` if needed

- [x] Change `openMain` IPC to accept `projectId` and `sessionId`.
- [x] Have main window navigate to `/workspace?sessionId=...`.
- [x] Teach Workspace to select `sessionId` from the URL after sessions load.
- [x] Keep a module-level Tray reference so the tray is not garbage-collected.

### Task 5: Documentation And Verification

**Files:**
- Modify: `docs/design/desktop-widget-implementation.md`
- Modify: `docs/design/desktop-widget.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `README.md`

- [x] Update docs from Agent-first to session-first.
- [x] Run focused widget/task/session tests.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Review `git diff --check` and the full diff before committing.
- [ ] Commit on `master`, merge into `prd`, and verify `prd` contains the commit.

Verification note: default parallel `npm test` hit ACP mock startup timeouts in three integration files; each failing file passed when rerun individually, and `npx vitest run --no-file-parallelism --maxWorkers=1` passed the full suite.
