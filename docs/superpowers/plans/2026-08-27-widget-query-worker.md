# Widget Query Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 1.2 second Widget event scan, isolate Widget session reads in Query Worker, and coalesce duplicate event-driven refreshes without changing Widget behavior.

**Architecture:** Add a typed Widget session read model to the existing QueryPort. The database implementation derives completion from finalized Agent messages and combines persisted running signals with API-provided active prompt IDs. Widget RPC handlers await this port, while the frontend store uses a debounced single-flight refresh coordinator with one dirty follow-up.

**Tech Stack:** TypeScript, better-sqlite3, Node Worker Threads, React/Zustand, Vitest.

**Spec:** User-approved in-chat design from task `task-225da5b4`.

## Global Constraints

- Do not add a database migration or an index over `session_events`.
- Preserve Widget response fields, filters, grouping, unread semantics, project filtering, task links, and running-state behavior.
- Do not restart or modify the running PRD service.
- Follow TDD and run full tests, lint, build, and `git diff --check` before merge.

---

### Task 1: Optimized Widget Session Read Model

**Files:**
- Create: `src/queries/widget-session-list-query.ts`
- Modify: `src/ports/query-port.ts`
- Modify: `src/queries/database-query-port.ts`
- Test: `tests/integration/query-read-model-performance.test.ts`

**Interfaces:**
- Consumes: `WidgetSessionListQuery` with optional `projectId` and `activePromptSessionIds`.
- Produces: `QueryPort.listWidgetSessions(input): Promise<WidgetSessionListItem[]>`.

- [ ] Add a failing read-model test proving an event-only `message.done` does not create completion and a finalized Agent message does.
- [ ] Add a failing query-count test proving the Widget projection uses one prepared SQL statement and preserves task/project/running data.
- [ ] Implement the typed query with finalized Agent message completion, persisted running signals, active prompt overlay, and no `session_events` scan.
- [ ] Run the focused read-model tests and confirm they pass.

### Task 2: Query Worker and Widget RPC Integration

**Files:**
- Modify: `src/queries/worker-query-port.ts`
- Modify: `src/data-worker/query-worker/operations.ts`
- Modify: `src/gateway/rpc/widget.ts`
- Test: `tests/integration/query-worker.test.ts`
- Test: `tests/integration/widget-rpc.test.ts`

**Interfaces:**
- Consumes: `QueryPort.listWidgetSessions` from Task 1.
- Produces: Worker operation `widget.sessions.list` and unchanged Widget RPC response shapes.

- [ ] Extend the Query Worker parity test to fail until Widget rows are transported through the read-only Worker.
- [ ] Update Widget RPC tests so finalized Agent messages are the canonical completion source and event-only fixtures are excluded from recent results.
- [ ] Add the Worker operation and client method, injecting current active prompt Session IDs.
- [ ] Replace the API-thread Widget session SQL with `await getQueryPort().listWidgetSessions(...)` in all handlers that consume it.
- [ ] Run Query Worker and Widget RPC focused tests and confirm they pass.

### Task 3: Coalesced Widget Refresh

**Files:**
- Modify: `ui/src/stores/widget.store.ts`
- Test: `tests/unit/widget-store.test.ts`

**Interfaces:**
- Consumes: existing Widget realtime events.
- Produces: at most one active request and one follow-up refresh after a burst.

- [ ] Add fake-timer tests proving burst events create one request and events during an in-flight request create exactly one follow-up.
- [ ] Implement a 150ms event debounce plus single-flight dirty follow-up, preserving direct/manual `fetchActivities` behavior.
- [ ] Verify cleanup cancels a scheduled refresh and does not leave stale listeners or timers.
- [ ] Run the Widget store tests and confirm they pass.

### Task 4: Verification, Review, and Integration

**Files:**
- Review all changed files and this plan.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: reviewed feature commit merged into `prd` without restarting PRD.

- [ ] Run focused tests, `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Commit the isolated branch and request an independent code review against its base commit.
- [ ] Fix all P0/P1/P2 findings and repeat required verification.
- [ ] Merge the approved branch into `prd`, preserving unrelated files in the dirty main worktree.
- [ ] Verify the merge commit and report exact commit hashes and test results.
