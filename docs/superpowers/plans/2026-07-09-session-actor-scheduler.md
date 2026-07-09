# Session Actor Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-process per-session actor scheduler so one noisy session cannot monopolize `session:update` processing.

**Architecture:** Keep the existing first-phase stream batching and SQLite schema. Route raw `session:update` events through a scheduler that keeps one queue per `sessionId`, processes sessions in round-robin order with a per-session event budget, and yields between turns. Critical updates flush the same session before continuing, while mergeable text/thinking/tool chunks continue to use the existing batcher at the consumer boundary.

**Tech Stack:** TypeScript, mitt events, Node timers, Vitest.

---

### Task 1: Actor Scheduler Unit

**Files:**
- Create: `src/core/session-update-actors.ts`
- Test: `tests/unit/session-update-actors.test.ts`

- [x] **Step 1: Write fairness tests**

Create unit tests proving that a scheduler with budget `2` processes two events from a noisy session, then yields to another session before draining the noisy session.

- [x] **Step 2: Write flush tests**

Create a test proving `flushSession(sessionId)` processes all queued updates for that session synchronously and preserves their order.

- [x] **Step 3: Run tests and verify red**

Run: `npm test -- tests/unit/session-update-actors.test.ts`

Expected: fail because `session-update-actors.ts` does not exist.

- [x] **Step 4: Implement scheduler**

Implement `SessionUpdateActorScheduler` with:

- `enqueue(ev)` for raw updates.
- `flushSession(sessionId)` for critical boundaries.
- `dispose()` for tests.
- `eventBudgetPerSession` option, default `25`.
- `scheduleDrain` option for tests, default `setImmediate`.
- `handleUpdate` callback supplied in constructor.

The scheduler should maintain active session order and call `handleUpdate` outside callers' synchronous stack except `flushSession`.

- [x] **Step 5: Verify unit tests**

Run: `npm test -- tests/unit/session-update-actors.test.ts`

Expected: pass.

### Task 2: Wire Session Updates Through Actor

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/ws-handler.ts`
- Test: `tests/unit/session-update-actors.test.ts`
- Test: `tests/integration/turn-process-items.test.ts`
- Test: `tests/integration/ws-capabilities.test.ts`

- [x] **Step 1: Add raw actor event type**

Add a separate internal event type such as `session:update:raw` if needed, keeping public `session:update` semantics unchanged for existing consumers.

- [x] **Step 2: Create one scheduler instance**

Create a scheduler in `src/core/sessions.ts` or a small helper module. Raw updates should enter the scheduler, then processed updates should emit the existing `session:update` event.

- [x] **Step 3: Flush actor before done**

On `session:done`, flush the actor queue for that session before existing done handlers persist `message.done`, finalize turn process, and broadcast done.

- [x] **Step 4: Avoid recursive scheduling**

Ensure scheduler output uses the existing processed event and does not enqueue itself again.

- [x] **Step 5: Verify integration tests**

Run: `npm test -- tests/unit/session-update-actors.test.ts tests/unit/session-update-batcher.test.ts tests/integration/turn-process-items.test.ts tests/integration/ws-capabilities.test.ts`

Expected: pass.

### Task 3: Performance Harness

**Files:**
- Create: `tests/unit/session-update-actors-perf.test.ts`

- [x] **Step 1: Add deterministic fairness/perf test**

Create a test with 100 noisy-session updates and 1 quiet-session update. Assert the quiet session is handled before the noisy session drains completely.

- [x] **Step 2: Run perf/fairness test**

Run: `npm test -- tests/unit/session-update-actors-perf.test.ts`

Expected: pass.

### Task 4: Verification And Commit

**Files:**
- All modified files

- [x] **Step 1: Run targeted tests**

Run: `npm test -- tests/unit/session-update-actors.test.ts tests/unit/session-update-actors-perf.test.ts tests/unit/session-update-batcher.test.ts tests/integration/turn-process-items.test.ts tests/unit/ws-broadcast.test.ts tests/integration/ws-capabilities.test.ts`

Expected: pass.

- [x] **Step 2: Run build**

Run: `npm run build`

Expected: pass, with only existing Vite chunk warnings.

- [x] **Step 3: Run diff check**

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 4: Commit**

Commit message: `perf: schedule session updates by actor`

- [x] **Step 5: Report rollout status**

Report that the optimization remains on `perf/session-event-batching` and is not deployed until merged and PRD is restarted during a maintenance window.
