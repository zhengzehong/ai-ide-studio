# Session Flow Phase 1 Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce PRD session flow hot-path pressure by batching intermediate stream events, throttling turn process writes, and removing high-frequency frontend work without changing critical session semantics.

**Architecture:** Keep the current single Node process and SQLite schema, but stop treating every stream chunk as an immediate full business update. Buffer only mergeable intermediate updates per session/message, flush them on a short timer, and synchronously flush before critical events such as `done`, permission, elicitation, error, and lifecycle transitions. Preserve final message correctness and recovery data while lowering DB writes, WS frames, and frontend render/log churn.

**Tech Stack:** Hono, ws, mitt, better-sqlite3, React/Zustand, Vitest.

---

### Task 1: Session Update Batching

**Files:**
- Create: `src/core/session-update-batcher.ts`
- Modify: `src/core/sessions.ts`
- Test: `tests/unit/session-update-batcher.test.ts`

- [ ] **Step 1: Add failing tests for mergeable update batching**

Create `tests/unit/session-update-batcher.test.ts` with tests that enqueue multiple `message.chunk` style updates for the same session/message and expect one flushed update with concatenated content. Include a second test that a critical permission request flushes pending content before the critical update.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- tests/unit/session-update-batcher.test.ts`

Expected: fail because `session-update-batcher.ts` does not exist.

- [ ] **Step 3: Implement the batcher**

Create `src/core/session-update-batcher.ts` exporting a small class/function API:

- `handleSessionUpdate(ev, apply)` receives an update.
- Mergeable updates are agent text `contentDelta`, thinking, and non-critical tool updates.
- Critical updates flush pending updates for the session first and then call `apply` immediately.
- `flushSession(sessionId, apply)` flushes pending updates for critical boundaries.
- Timer defaults: text flush around 100ms, thinking/tool around 300ms.

- [ ] **Step 4: Wire `src/core/sessions.ts` event persistence through the batcher**

Keep existing lifecycle/title/session changed handling intact. Route event persistence and `session:event` emission through the batcher so the persisted `session_events` table receives merged stream updates instead of one row per chunk. Do not buffer `message.user`, `message.done`, permission, elicitation, cancellation, or errors.

- [ ] **Step 5: Run targeted tests**

Run: `npm test -- tests/unit/session-update-batcher.test.ts tests/integration/turn-process-items.test.ts`

Expected: pass.

### Task 2: Turn Process Throttling

**Files:**
- Modify: `src/core/turn-process-runtime.ts`
- Modify: `src/store/turn-process-items.ts`
- Test: `tests/integration/turn-process-items.test.ts`

- [ ] **Step 1: Add failing tests for thinking/process throttling**

Extend `tests/integration/turn-process-items.test.ts` to emit several thinking chunks quickly and assert that turn process persistence is coalesced enough to avoid one process item write per chunk, while final `completeTurnProcess` still flushes all text.

- [ ] **Step 2: Run test and verify it fails**

Run: `npm test -- tests/integration/turn-process-items.test.ts`

Expected: new throttling test fails under the current per-chunk `appendText` behavior.

- [ ] **Step 3: Implement process write throttling**

Update `turn-process-runtime.ts` so thinking text and repeated tool update previews can be buffered per active turn and flushed on a short timer or before critical operations. Keep final answer snapshot flushing behavior from the previous PRD hot-path commit.

- [ ] **Step 4: Reduce repeated process count writes**

Update `turn-process-items.ts` so repeated upserts for the same item can skip `updateMessageProcessCount` when the item already exists and kind is unchanged. Ensure new items still update the count.

- [ ] **Step 5: Run targeted tests**

Run: `npm test -- tests/integration/turn-process-items.test.ts`

Expected: pass.

### Task 3: Frontend High-Frequency Churn Reduction

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Test: existing frontend store tests if applicable

- [ ] **Step 1: Remove high-frequency console logging**

Remove or guard `console.info`/`console.debug` calls inside realtime `session:update` and `flushStreamingBuffer` hot paths. Do not introduce new visible UI text.

- [ ] **Step 2: Throttle session cache saves on realtime updates**

Replace immediate `saveCache(sid, get())` calls inside high-frequency realtime paths with a per-session delayed save, while keeping critical transitions such as session selection, done, and manual fetch completion able to save immediately.

- [ ] **Step 3: Run frontend/store targeted tests**

Run: `npm test -- tests/unit/session-store-done-refresh.test.ts`

Expected: may still show existing unrelated failures in this repository. If so, document exact failures and run a narrower relevant test if available.

### Task 4: Verification And Commit

**Files:**
- All modified files

- [ ] **Step 1: Run targeted backend tests**

Run: `npm test -- tests/unit/session-update-batcher.test.ts tests/integration/turn-process-items.test.ts tests/unit/ws-broadcast.test.ts tests/integration/ws-capabilities.test.ts`

Expected: pass.

- [ ] **Step 2: Run build and lint on modified files**

Run: `npm run build`

Expected: pass, with only existing Vite chunk warnings if present.

Run: `npx eslint src/core/session-update-batcher.ts src/core/sessions.ts src/core/turn-process-runtime.ts src/store/turn-process-items.ts ui/src/stores/session.store.ts`

Expected: pass for modified files.

- [ ] **Step 3: Check diff and commit**

Run: `git diff --check`

Expected: no whitespace errors.

Commit message: `perf: batch session stream updates`

- [ ] **Step 4: Report rollout status**

Report that the branch commit is ready but not deployed to PRD until merged and the running `node dist/entry.js` process is restarted during a maintenance window.
