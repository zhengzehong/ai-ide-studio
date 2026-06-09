# ISSUE-016 Live Plan Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the top live plan bar as a current-turn runtime aid only, without rewriting model plan statuses or leaking stale plans after a turn ends.

**Architecture:** Persisted process plan blocks remain the source of truth for historical plan snapshots. The session-level `plan` store mirrors only live `plan.update` events during execution and is cleared on turn completion.

**Tech Stack:** React/Zustand frontend state, Vitest.

---

### Task 1: Regression Tests

**Files:**
- Modify: `tests/unit/session-event-reducer.test.ts`
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [x] **Step 1: Update reducer expectation**

Change the reducer test so `message.done` clears `state.plan` instead of marking `in_progress` entries completed.

- [x] **Step 2: Add live store done expectation**

Add a store listener test proving `session:done` clears the live `plan`.

- [x] **Step 3: Run tests to verify failure**

Run: `npm test -- tests/unit/session-event-reducer.test.ts tests/unit/session-store-done-refresh.test.ts`

Expected before implementation: at least one assertion fails because live plan still contains completed entries after done.

### Task 2: Implementation

**Files:**
- Modify: `ui/src/stores/session-events.ts`
- Modify: `ui/src/stores/session.store.ts`

- [x] **Step 1: Replace finalize helper with clear helper**

Use a small helper that returns `[]` on `message.done` so reducer replay does not infer completion.

- [x] **Step 2: Clear live plan on websocket done**

In all `session:done` branches, set `plan: []`.

- [x] **Step 3: Keep plan.update raw**

Continue assigning `data.plan` and `payload.plan` directly on live updates.

### Task 3: Verification And Sync

- [x] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/session-event-reducer.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/plan-visibility.test.ts`

- [x] **Step 2: Run full tests**

Run: `npm test`

- [ ] **Step 3: Commit and sync PRD**

Commit only ISSUE-016 related files on master, cherry-pick to PRD, and verify the targeted tests on PRD.
