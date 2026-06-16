# Event Driven Task Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents subscribe to task lifecycle events by payload fields, inspect project agents/sessions/timelines, and dynamically assign unassigned tasks.

**Architecture:** Event Center remains category-light and gains payload field filtering plus list-display schema hints. Task changes emit one `task.lifecycle` category with structured payload. Dispatcher agents use platform tools (`studio.task.assign`, `core.session.list`, `core.timeline.list`) to pick an agent and session.

**Tech Stack:** TypeScript, Hono/WS RPC, better-sqlite3, React 19, Zustand, Vitest.

---

### Task 1: Event Center Payload Filtering

**Files:**
- Modify: `src/core/event-center.ts`
- Test: `tests/unit/event-center-service.test.ts`

- [x] Add failing coverage for `filter.payload` equality, null, `in`, and `exists`.
- [x] Extend subscription matching without adding a new table or DSL.

### Task 2: Event Schema Field Display

**Files:**
- Modify: `ui/src/pages/event-center/helpers.ts`
- Modify: `ui/src/pages/event-center/EventInboxPanel.tsx`
- Modify: `ui/src/pages/event-center/SubscriptionCreateModal.tsx`

- [x] Parse `x-list`, `x-filter`, and `enum` schema hints.
- [x] Show `x-list` payload values in event list rows.
- [x] Let subscription creation store simple payload filters.

### Task 3: Task Lifecycle Events

**Files:**
- Modify: `src/store/migrations/014-event-center.ts`
- Modify: `src/core/event-center.ts`
- Modify: `src/core/tasks.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/tools/handlers/studio-task-tools.ts`

- [x] Seed or lazily ensure `task.lifecycle`.
- [x] Emit lifecycle events for task create, assign, progress, status changes, failure, and review.
- [x] Keep event writes best-effort so task operations are not blocked by event-center setup issues.

### Task 4: Dispatcher Tools

**Files:**
- Modify: `src/tools/handlers/studio-task-tools.ts`
- Modify: `src/tools/handlers/core/session-tools.ts`
- Modify: `src/tools/handlers/core/index.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`
- Test: `tests/unit/core-tool-handlers.test.ts`
- Test: `tests/unit/tool-seed.test.ts`

- [x] Add `studio.task.assign` with guarded reassign semantics.
- [x] Return `activity_state` from `core.session.list`.
- [x] Add `core.timeline.list` for timeline summaries.

### Task 5: Verification and Branch Sync

**Files:**
- Current branch and local `prd` worktree.

- [x] Run targeted Vitest suites.
- [x] Run build/lint checks where feasible.
- [x] Review diff for unrelated changes and secrets.
- [ ] Commit only this feature's files.
- [ ] Cherry-pick the commit into local `prd`.
