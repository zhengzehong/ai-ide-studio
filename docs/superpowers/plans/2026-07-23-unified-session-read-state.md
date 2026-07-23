# Unified Session Read State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PC Session, Agent, and Project unread indicators consistent and self-healing across refreshes and realtime disconnects.

**Architecture:** SQLite timestamps remain durable truth. A small PC read fence overlays optimistic acknowledgements and newer realtime transitions on Session list snapshots. Shared indicator aggregation drives Agent and active Project counts, while inactive Project summaries retain the lightweight backend aggregate with heartbeat and stale refresh recovery.

**Tech Stack:** TypeScript, Zustand, React 19, WebSocket, Vitest, better-sqlite3.

---

### Task 1: Canonical backend read contract

**Files:**
- Modify: `src/commands/session-command-service.ts`
- Modify: `src/gateway/rpc/widget.ts`
- Modify: `src/store/sessions.ts`
- Modify: `tests/integration/session-command-service.test.ts`
- Modify: `tests/integration/project-session-stats.test.ts`

- [ ] Change the existing command-service test to require `data.last_read_at` and verify that `lastReadAt` is absent.
- [ ] Add a database test that creates a Session and asserts its persisted `last_read_at` equals the returned initial value.
- [ ] Run the two tests and confirm they fail on the current camelCase event and omitted INSERT column.
- [ ] Broadcast `last_read_at` from both mark-read paths and include `last_read_at` in the Session INSERT column/value lists.
- [ ] Run the focused integration tests and commit `fix(read-state): normalize durable read events`.

### Task 2: Read fence and authoritative Session reconciliation

**Files:**
- Create: `ui/src/stores/session-read-fence.ts`
- Create: `tests/unit/session-read-fence.test.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [ ] Write pure failing tests for pending read acknowledgement over stale server data, server confirmation, and a background unread transition after a request checkpoint.
- [ ] Run `npx vitest run tests/unit/session-read-fence.test.ts` and confirm failures are caused by the missing helper.
- [ ] Implement the minimal monotonic fence and scope replacement reconciler.
- [ ] Add failing store tests proving a server-read snapshot removes old local unread state, a stale response cannot resurrect a selected Session, canonical `last_read_at` clears cached unread state, and visible `session:done` submits a read command.
- [ ] Update Session selection, list commits, realtime changed/activity/done handlers, and deletion cleanup to use the fence.
- [ ] Run focused Session tests and commit `fix(ui): fence session read state refreshes`.

### Task 3: Shared Session, Agent, and active Project aggregation

**Files:**
- Modify: `ui/src/utils/session-indicators.ts`
- Create: `ui/src/hooks/use-unified-project-session-stats.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/components/layout/ProjectTabBar.tsx`
- Modify: `ui/src/components/layout/ProjectSwitcher.tsx`
- Modify: `tests/unit/session-activity-indicators.test.ts`
- Create: `tests/unit/unified-project-session-stats.test.ts`

- [ ] Add failing tests for one shared summarizer and for active-project overlay preserving inactive backend summaries.
- [ ] Implement `summarizeSessionIndicators` and the pure project-stat overlay helper.
- [ ] Replace Workspace's inline Agent aggregation and both Project badge consumers with the shared helpers.
- [ ] Run focused indicator tests and commit `fix(ui): unify activity badge summaries`.

### Task 4: Realtime heartbeat and Project summary recovery

**Files:**
- Modify: `ui/src/services/ws-client.ts`
- Modify: `ui/src/stores/project-session-stats.store.ts`
- Modify: `tests/unit/ws-client.test.ts`
- Modify: `tests/unit/project-session-stats-store.test.ts`

- [ ] Add failing fake-timer tests for 15-second ping, any inbound frame extending the deadline, 30-second timeout reconnect, and disconnect cleanup.
- [ ] Implement heartbeat lifecycle without changing subscription/resume ordering.
- [ ] Add failing tests for 30-second stale refresh and visible-document forced recovery.
- [ ] Add the bounded interval and visibility/focus listeners to the Project stats store.
- [ ] Run focused realtime and stats tests and commit `fix(realtime): recover stale activity summaries`.

### Task 5: Verification and PRD integration

**Files:**
- Modify if required: `docs/architecture/overview.md`
- Modify if required: `docs/architecture/ws-protocol.md`
- Modify if required: `docs/guides/testing.md`
- Modify if required: `README.md`

- [ ] Update stable architecture and protocol documentation for canonical read events and PC heartbeat recovery.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/check-ui-bundle.mjs` and `git diff --check prd..HEAD`.
- [ ] Merge `fix/unified-session-read-state` into `prd` with `--no-ff` and repeat focused tests on the merged result.
- [ ] Remove the merged worktree and branch. Do not restart PRD.
