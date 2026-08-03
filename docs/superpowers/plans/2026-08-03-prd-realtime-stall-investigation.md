# PRD Realtime Cursor Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Runtime-created realtime cursor gaps and make gap recovery converge without losing the final Session result.

**Architecture:** Runtime UI delivery remains the sole allocator of realtime cursors; persistence must wait for and reuse the UI cursor for the same coalesced update. Realtime preserves critical completion semantics during a gap, while the browser acknowledges the gap before background project refresh and performs canonical Session recovery without leaving a stale running state.

**Tech Stack:** TypeScript, Node.js IPC/WebSocket, React/Zustand, Vitest.

---

### Task 1: Make UI Cursor Allocation Authoritative

**Files:**
- Modify: `src/runtime/streams/runtime-update-coalescer.ts`
- Modify: `src/runtime/service/service.ts`
- Test: `tests/unit/runtime-update-coalescer.test.ts`

- [x] Add a failing test where persistence is due when a new same-key update arrives, and assert persistence cannot run before the matching UI emission.
- [x] Run `npx vitest run tests/unit/runtime-update-coalescer.test.ts` and confirm the new ordering test fails.
- [x] Serialize persistence flushes behind the pending UI flush for the same scope and remove the `host.nextCursor()` persistence fallback.
- [x] Re-run the test and confirm cursor reuse passes without allocating invisible sequences.

### Task 2: Preserve Critical Completion During Resync

**Files:**
- Modify: `src/realtime/hub.ts`
- Test: `tests/unit/realtime-hub.test.ts`

- [x] Add a failing test that creates a cursor gap followed by `session:done` and asserts the client still receives a completion signal.
- [x] Run `npx vitest run tests/unit/realtime-hub.test.ts` and confirm the new test fails.
- [x] Keep the resync barrier for noncritical stream updates but allow a critical `session:done` frame after the resync marker.
- [x] Re-run the test and confirm FIFO ordering is `resync_required` then `session:done`.

### Task 3: Make Browser Recovery Converge

**Files:**
- Modify: `ui/src/app-runtime-bootstrap.ts`
- Test: `tests/unit/app-runtime-bootstrap.test.ts`
- Test: `tests/unit/session-store-done-refresh.test.ts` only if store behavior needs adjustment

- [x] Add a failing test proving `acknowledgeResync` is not blocked by project refresh and canonical recovery runs after acknowledgment.
- [x] Run `npx vitest run tests/unit/app-runtime-bootstrap.test.ts` and confirm the ordering test fails.
- [x] Acknowledge the session gap immediately, recover current messages/recovery, and run project refresh after the Session can receive events again.
- [x] Confirm the preserved `session:done` path converges without a second canonical recovery.
- [x] Re-run the targeted frontend tests.

### Task 4: Integration Regression and Documentation

**Files:**
- Modify: `tests/integration/runtime-realtime-stream.test.ts` or add a focused integration test beside it
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md`

- [x] Add an integration regression covering persistence/UI timing, cursor gap recovery, and final completion.
- [x] Document cursor ownership and resync completion guarantees.
- [x] Run targeted tests, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [x] Commit the isolated fix, request review, then merge into `prd` without restarting the running service.
