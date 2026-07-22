# Session Activity Fence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep PC session and agent running indicators consistent with terminal realtime events even when cached state is reactivated or an older list response arrives late.

**Architecture:** Add a small ordered activity overlay inside the PC session store. Activity transitions update scoped cache immediately, and session-list responses apply only transitions that occurred after the request began.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest

---

### Task 1: Reproduce stale cached activity

**Files:**
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [x] Add a test that loads a running session, emits `session:activity idle`, reactivates the same project, and expects the running indicator to remain cleared.
- [x] Run `npx vitest run tests/unit/session-store-done-refresh.test.ts` and confirm the new test fails because cached `activity_state` remains `running`.

### Task 2: Reproduce a late list response

**Files:**
- Modify: `tests/unit/session-store-done-refresh.test.ts`

- [x] Add a deferred `sessions.list` response that reports running, emit `idle` while the request is pending, then resolve the response.
- [x] Assert the response cannot restore `runningSessionIds` and a later `running` event can start a new indicator.
- [x] Run the targeted test and confirm failure before implementation.

### Task 3: Implement ordered activity overlay

**Files:**
- Modify: `ui/src/stores/session.store.ts`

- [x] Record monotonic per-session activity revisions.
- [x] Patch visible sessions and all list-cache scopes on local/realtime activity transitions.
- [x] Capture the activity revision at list-request start and overlay newer transitions before committing the response.
- [x] Clear activity history on session deletion.
- [x] Run the targeted test until both regressions pass.

### Task 4: Verify and integrate

**Files:**
- Verify only

- [x] Run the relevant session/project unit tests.
- [x] Run `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, `node scripts/check-ui-bundle.mjs`, and `git diff --check`.
- [ ] Commit the implementation, merge `fix/session-activity-fence` into `prd` with `--no-ff`, and repeat critical verification on merged `prd`.
