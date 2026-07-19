# Local Performance Architecture Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Phase 1 HTTP read models to a dedicated read-only SQLite worker, establish the single-writer queue and transactional outbox, and route the first latency-sensitive session persistence operations through asynchronous data ports without changing PC or mobile behavior.

**Architecture:** The API event loop talks to one Query Worker and one Writer Worker through typed `worker_threads` request/response envelopes. The Query Worker owns a `mode=ro`/`query_only` connection and runs the existing task, session, message, and event read models; the Writer Worker owns the new queued write path, enforces priority and session ordering, batches background mutations, and commits outbox rows atomically. Existing synchronous stores remain a measured compatibility boundary for domains that cannot move before the Runtime process extraction; Phase 2 must not hide that debt or claim that the final `getDb()` prohibition is already complete.

**Tech Stack:** TypeScript 6, Node.js 24 `worker_threads`, better-sqlite3 12, Hono, Pino, Vitest 4.

---

## Scope Decision

The architecture spec estimated Phase 2 at two to four weeks because the repository currently has more than forty production modules calling `getDb()` and more than one hundred Core/Gateway/Tool imports of synchronous stores. Converting all those APIs to promises before Runtime extraction would force a broad rewrite of ACP and tool lifecycles and would make the worker change impossible to review or roll back.

This plan therefore preserves the approved final physical boundary while using a strangler migration:

1. `/api/v1` task/session/history reads must use the Query Worker in the production app.
2. Query priority, deadlines, failure isolation, restart, metrics, and graceful shutdown must be real, not stubs.
3. The Writer Worker must implement the final scheduling semantics and be exercised by real persistence/outbox operations.
4. Latency-sensitive session snapshot/event writes selected in Task 4 must stop running synchronous SQL on the caller loop.
5. Remaining synchronous stores are explicitly inventoried and guarded as compatibility debt for Phase 3/4. The strict process-wide `getDb()` ban is activated when Runtime and legacy WS RPC leave the API process, not simulated with `Atomics.wait`.

`Atomics.wait`, a synchronous worker proxy, raw-SQL-over-MessagePort, a second writer, and public HTTP calls from Runtime are prohibited.

## File Map

- Create `src/data-worker/protocol.ts`: clone-safe request, response, priority, error, and metrics contracts.
- Create `src/data-worker/priority-queue.ts`: stable two/three-level priority queue with queue-deadline checks.
- Create `src/data-worker/worker-entry-url.ts`: `.ts` under `tsx`/Vitest and `.js` under `dist` worker entry resolution.
- Create `src/data-worker/worker-rpc-client.ts`: request correlation, timeouts, crash rejection, restart hook, and drain/close.
- Create `src/data-worker/query-worker/entry.ts`: read-only SQLite ownership and queued query dispatch.
- Create `src/data-worker/query-worker/operations.ts`: closed query operation registry over Phase 1 read models.
- Create `src/queries/worker-query-port.ts`: `QueryPort` adapter backed by the Query Worker.
- Create `src/queries/query-port-provider.ts`: process-local default/override used by HTTP and WS compatibility adapters.
- Modify `src/ports/query-port.ts`: query priority/deadline metadata and active-prompt snapshot input.
- Modify `src/queries/local-query-port.ts`: preserve deterministic in-process tests while accepting active-prompt IDs.
- Modify `src/store/db.ts`: explicit read-only initialization and connection-mode introspection.
- Modify `src/core/sessions.ts`: expose an immutable active-prompt ID snapshot.
- Modify `src/gateway/http/query-routes.ts`: mark browser reads interactive and map worker unavailability/deadline to 503/504.
- Modify `src/gateway/rpc/tasks.ts` and `src/gateway/rpc/sessions.ts`: resolve the configured Query Port instead of importing the local adapter.
- Create `src/ports/write-data-port.ts`: closed writer command/persistence/outbox contracts.
- Create `src/data-worker/writer-worker/scheduler.ts`: critical/interactive/background arbitration and batch limits.
- Create `src/data-worker/writer-worker/operations.ts`: transaction-scoped mutation registry and idempotency/order checks.
- Create `src/data-worker/writer-worker/entry.ts`: sole queued Writer Worker connection and dispatch loop.
- Create `src/data-worker/writer-worker/client.ts`: `WriteDataPort` worker adapter.
- Create `src/store/migrations/043-writer-outbox.ts`: `writer_batch_commits` and `outbox_events` schema/indexes.
- Modify `src/store/migrations/index.ts`: register migration 043.
- Create `src/core/persistence/session-persistence-port.ts`: caller-facing session mutation adapter.
- Modify `src/core/session-update-batcher.ts`: async flush contract with per-session drain.
- Modify `src/core/sessions.ts`: route the selected session event/snapshot/done writes through the persistence port and publish only after commit.
- Modify `src/app.ts`: migrate/seed before workers, start both workers, inject ports, and drain/close in dependency order.
- Modify `src/gateway/server.ts`: accept app-scoped ports rather than importing a concrete query adapter.
- Create `tests/unit/data-worker-priority-queue.test.ts`: stable priority and expiry behavior.
- Create `tests/unit/writer-worker-scheduler.test.ts`: flush and batch threshold behavior.
- Create `tests/integration/query-worker.test.ts`: read-only enforcement, parity, priority, crash, restart, and non-blocking event-loop coverage.
- Create `tests/integration/writer-worker.test.ts`: batching, ordering, deduplication, outbox atomicity, rollback, and crash behavior.
- Modify `tests/integration/http-query-routes.test.ts`: production-style worker injection and 503/504 mapping.
- Modify `tests/unit/session-update-batcher.test.ts`: asynchronous drain and critical flush ordering.
- Modify `docs/architecture/overview.md`, `docs/architecture/data-model.md`, and `README.md`: stable worker ownership, outbox model, observability, rollback, and compatibility boundary.

## Task 1: Worker Protocol And Stable Priority Queues

**Files:**
- Create: `src/data-worker/protocol.ts`
- Create: `src/data-worker/priority-queue.ts`
- Create: `src/data-worker/worker-entry-url.ts`
- Create: `src/data-worker/worker-rpc-client.ts`
- Test: `tests/unit/data-worker-priority-queue.test.ts`

- [x] **Step 1: Write failing queue and RPC lifecycle tests**

Cover stable FIFO within a priority, `interactive` before `background`, `critical` before both, expired work rejected before execution, request timeout cleanup, worker error rejection, and close rejecting new work. Use a small fixture worker under `tests/fixtures/` only if a real Worker is required; do not test mocks alone.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/unit/data-worker-priority-queue.test.ts`

Expected: FAIL because the data-worker modules do not exist.

- [x] **Step 3: Define clone-safe contracts**

Use discriminated envelopes with no functions, class instances, `Error` objects, or SQLite objects:

```ts
export type QueryPriority = 'interactive' | 'background'
export type WritePriority = 'critical' | 'interactive' | 'background'

export interface WorkerRequest<TPayload = unknown> {
  kind: 'request'
  requestId: string
  operation: string
  priority: QueryPriority | WritePriority
  enqueuedAt: number
  deadlineAt?: number
  payload: TPayload
  payloadBytes: number
}

export type WorkerResponse<TResult = unknown> =
  | { kind: 'result'; requestId: string; result: TResult; metrics: WorkerMetrics }
  | { kind: 'error'; requestId: string; error: WorkerErrorPayload; metrics: WorkerMetrics }
```

`WorkerMetrics` contains queue depth, queue wait, execution time, total time, and payload bytes. `WorkerErrorPayload.code` is one of `BAD_REQUEST`, `DEADLINE_EXCEEDED`, `WORKER_UNAVAILABLE`, `SQLITE_ERROR`, `ORDER_CONFLICT`, or `INTERNAL`.

- [x] **Step 4: Implement stable queues and RPC client**

The queue stores a monotonic insertion ordinal. `dequeue()` checks priority first and ordinal second. Deadlines are evaluated immediately before execution. The client maintains one pending map, removes entries on every terminal path, rejects all entries on crash, and has explicit `drain()` and `close()` methods.

- [x] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/data-worker-priority-queue.test.ts`

Expected: PASS with no open-handle warning.

Commit: `feat(data): add typed worker queues and RPC lifecycle`

## Task 2: Read-Only Query Worker And Production Query Port

**Files:**
- Create: `src/data-worker/query-worker/entry.ts`
- Create: `src/data-worker/query-worker/operations.ts`
- Create: `src/queries/worker-query-port.ts`
- Create: `src/queries/query-port-provider.ts`
- Modify: `src/ports/query-port.ts`
- Modify: `src/queries/local-query-port.ts`
- Modify: `src/store/db.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/http/query-routes.ts`
- Modify: `src/gateway/rpc/tasks.ts`
- Modify: `src/gateway/rpc/sessions.ts`
- Modify: `src/gateway/server.ts`
- Test: `tests/integration/query-worker.test.ts`
- Test: `tests/integration/http-query-routes.test.ts`

- [x] **Step 1: Write failing real-worker tests**

Initialize and seed a temporary SQLite database on the test thread, close it, then start a real Query Worker. Assert all four Phase 1 operations equal `localQueryPort` results. Assert a test-only attempted write fails with `SQLITE_ERROR`, `PRAGMA query_only` is `1`, an expired background request is rejected, a queued interactive request overtakes queued background work, and terminating the worker rejects pending requests without hanging Vitest.

Add an event-loop isolation assertion: execute a worker fixture query that blocks its own thread for at least 150ms while a 10ms interval on the test thread records a maximum gap below 75ms.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/integration/query-worker.test.ts`

Expected: FAIL because `createWorkerQueryPort` and the Query Worker entry do not exist.

- [x] **Step 3: Add explicit read-only database initialization**

`initReadonlyDatabase(path)` opens `better-sqlite3` with `{ readonly: true, fileMustExist: true }`, sets `query_only=ON` and `foreign_keys=ON`, and never runs migrations or legacy JSON import. `initDatabase` remains the only migration/write initializer. Tests can inspect `getDatabaseMode()` without receiving the raw database.

- [x] **Step 4: Implement the closed operation registry**

Only these operation names are accepted:

```text
tasks.list
sessions.list
sessions.messages
sessions.events
worker.inspect
```

The worker calls `createLocalQueryPort` only after read-only initialization. `sessions.list` receives `activePromptSessionIds` captured by the caller so the worker does not import Runtime ownership. Unknown operations return `BAD_REQUEST`.

- [x] **Step 5: Implement `WorkerQueryPort` and provider injection**

The adapter adds the immutable active-prompt snapshot, defaults browser and WS compatibility reads to `interactive`, and exposes `close()`. The provider defaults to `localQueryPort` for isolated unit tests, but `startApp` must configure the worker adapter before mounting Gateway routes. HTTP and legacy WS compatibility handlers resolve the provider per request.

- [x] **Step 6: Map availability without hiding failures**

HTTP maps `DEADLINE_EXCEEDED` to 504 and `WORKER_UNAVAILABLE` to 503, logs request ID/queue metrics, and preserves old snapshots in the UI through existing store behavior. It must not silently fall back to synchronous SQL in production; rollback is an explicit app configuration switch.

- [x] **Step 7: Run parity/regression tests and commit**

Run:

```bash
npx vitest run tests/integration/query-worker.test.ts tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/integration/query-read-model-performance.test.ts
```

Expected: PASS; worker and local results are identical and the caller event loop remains responsive.

Commit: `perf(data): move phase one reads to query worker`

## Task 3: Writer Scheduler, Idempotent Batches, And Transactional Outbox

**Files:**
- Create: `src/ports/write-data-port.ts`
- Create: `src/data-worker/writer-worker/scheduler.ts`
- Create: `src/data-worker/writer-worker/operations.ts`
- Create: `src/data-worker/writer-worker/entry.ts`
- Create: `src/data-worker/writer-worker/client.ts`
- Create: `src/store/migrations/043-writer-outbox.ts`
- Modify: `src/store/migrations/index.ts`
- Test: `tests/unit/writer-worker-scheduler.test.ts`
- Test: `tests/integration/writer-worker.test.ts`
- Test: `tests/integration/sqlite-migration.test.ts`

- [x] **Step 1: Write failing scheduler tests**

Using fake clock only for queue timing, assert:

- background flushes at 25ms, 100 mutations, or 256KiB, whichever is first;
- interactive work is one request per transaction;
- critical work first flushes pending work for the same session, then commits alone;
- critical work for session A does not force unrelated background work for session B;
- FIFO is preserved within priority.

- [x] **Step 2: Run scheduler RED**

Run: `npx vitest run tests/unit/writer-worker-scheduler.test.ts`

Expected: FAIL because the Writer scheduler does not exist.

- [x] **Step 3: Add outbox and batch-commit schema**

Migration 043 creates:

```sql
CREATE TABLE writer_batch_commits (
  batch_id TEXT PRIMARY KEY,
  session_id TEXT,
  stream_generation TEXT,
  first_sequence INTEGER,
  last_sequence INTEGER,
  committed_at TEXT NOT NULL
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
```

Indexes cover unpublished ordering and aggregate version lookup. Migration tests verify schema and re-open idempotency.

- [x] **Step 4: Define a closed mutation union**

Do not send arbitrary SQL. The initial registry accepts explicit mutations for session event append, running-message snapshot update, session touch/stage update, and outbox enqueue. Every batch has `batchId`, optional session/generation/sequence bounds, priority, and estimated bytes.

- [x] **Step 5: Implement ordering and deduplication in the transaction**

For a repeated `batchId`, return the recorded commit without reapplying mutations. For one session/generation, reject overlapping or decreasing sequences with `ORDER_CONFLICT`. A new generation may restart sequence only after previous pending work for that session drains. Business rows, batch commit, and outbox rows commit in one transaction; any mutation failure rolls back all three.

- [x] **Step 6: Write and run real-writer integration tests**

Test 30 sessions enqueueing background batches concurrently, duplicate `batchId`, out-of-order sequence, critical same-session flush, a deliberate constraint failure rollback, outbox atomicity, client timeout, worker termination, and clean restart against the same WAL database.

Run:

```bash
npx vitest run tests/unit/writer-worker-scheduler.test.ts tests/integration/writer-worker.test.ts tests/integration/sqlite-migration.test.ts
```

Expected: PASS; exactly one copy of every accepted batch exists and rollback leaves no outbox row.

Commit: `feat(data): add ordered writer batches and outbox`

## Task 4: First Session Persistence Migration

**Files:**
- Create: `src/core/persistence/session-persistence-port.ts`
- Modify: `src/core/session-update-batcher.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/core/turn-process-runtime.ts`
- Test: `tests/unit/session-update-batcher.test.ts`
- Test: `tests/integration/session-events.test.ts`
- Test: `tests/integration/session-done-error.test.ts`
- Test: `tests/integration/acp-prompt-completion.test.ts`

- [ ] **Step 1: Write failing async drain tests**

The batcher callback returns a promise. Assert `flushSession(sessionId)` waits for queued and in-flight persistence, preserves merged event order, propagates failure to the critical caller, and allows unrelated sessions to continue.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/session-update-batcher.test.ts`

Expected: FAIL because the current callback and flush methods are synchronous.

- [ ] **Step 3: Add the session persistence adapter**

The adapter generates one `streamGeneration` per active turn and monotonic sequence values after coalescing. Mergeable update events use background batches. User message, permission result, cancel, and done use critical batches. Done calls `flushSession`, waits for the final message/event commit, then permits `session.done` publication.

- [ ] **Step 4: Migrate only operations represented by the closed Writer union**

Replace direct synchronous event append, running snapshot update, session touch/stage update, and final done event in the session hot path. Keep transformation and event payload construction in Core. Emit persisted `session:event`/`session:changed` notifications only after the Writer acknowledges commit. Do not duplicate-write to the old store.

- [ ] **Step 5: Verify behavior and ordering**

Run:

```bash
npx vitest run tests/unit/session-update-batcher.test.ts tests/integration/session-events.test.ts tests/integration/session-done-error.test.ts tests/integration/acp-prompt-completion.test.ts tests/unit/session-finalize.test.ts
```

Expected: PASS; persisted sequences remain contiguous, done is last, and a failed write prevents a false done notification.

Commit: `perf(runtime): persist session hot path through writer worker`

## Task 5: App Lifecycle, Observability, Rollback, And Phase Gate

**Files:**
- Modify: `src/app.ts`
- Modify: `src/core/config.ts`
- Modify: `src/gateway/server.ts`
- Modify: `src/store/db.ts`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `README.md`
- Create: `tests/integration/data-worker-lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Start the app on an ephemeral port and temporary database. Assert both workers become ready before HTTP accepts traffic, Query failure produces 503 while Writer stays usable, Writer failure rejects new persistence while Query stays usable, restart restores service, and `stop()` drains Writer before closing database resources. Assert no worker or timer remains after stop.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/data-worker-lifecycle.test.ts`

Expected: FAIL because app-scoped worker lifecycle is not wired.

- [ ] **Step 3: Wire startup and shutdown order**

Startup order is migration/legacy import, seed, close bootstrap connection where compatible, Writer ready, Query ready, Gateway listen. Shutdown order is stop new HTTP/WS work, flush session batchers, drain Writer, checkpoint WAL, close Query, close Writer, close remaining compatibility DB, then finish process shutdown.

- [ ] **Step 4: Add structured worker metrics and explicit rollback**

Log operation, requestId, priority, queue depth, queue wait, SQL/transaction time, total time, and payload bytes. Slow thresholds are configurable. `DATA_WORKER_MODE=local` is the temporary explicit rollback switch; default production mode is `worker`. There is no automatic synchronous fallback after a worker crash.

- [ ] **Step 5: Inventory compatibility debt and add a regression gate**

Document remaining direct `getDb()` callers by domain. Add a test or lint script that fails if a new direct caller appears outside the recorded allowlist. The allowlist may shrink but cannot grow without updating the architecture decision. Confirm `src/gateway/http/query-routes.ts` and migrated persistence modules have zero direct synchronous store/database imports.

- [ ] **Step 6: Update stable documentation**

Architecture docs describe ownership and flow, not implementation phases. Data-model docs define batch commits and outbox retention. README documents worker mode, rollback, and troubleshooting. The implementation checklist remains only in this file.

- [ ] **Step 7: Run focused performance and fault checks**

Run the worker suites plus a 30-session synthetic write load. Record p50/p95 queue wait and main-thread interval gap. Acceptance for this phase is no lost/duplicate batch, no false done, Query isolation under a 150ms slow query, and clean worker termination.

- [ ] **Step 8: Run full repository verification**

Run in order:

```bash
npm test
npm run build
npm run lint
git diff --check 3c1b1ef..HEAD
git diff 3c1b1ef..HEAD -- mobile/
git status --short
```

Expected: all tests/build/lint pass, diff check has no output, `mobile/` has no changes, and the worktree is clean after the final Phase 2 commit.

- [ ] **Step 9: Commit documentation and report Phase 2**

Commit: `docs: document query and writer worker ownership`

Do not merge into `prd`. Report commits, test evidence, worker queue metrics, event-loop isolation result, rollback procedure, remaining compatibility allowlist, and exact Phase 3 entry conditions.

## Self-Review

- Spec coverage: one Query Worker, one Writer Worker, read-only enforcement, three write priorities, 25ms/100/256KiB background limits, critical same-session flush, generation/sequence ordering, `batchId` dedupe, outbox atomicity, worker failure isolation, observability, rollback, and graceful shutdown are each assigned to a task.
- No synchronous worker proxy or raw SQL transport is introduced.
- The plan explicitly distinguishes the final architecture from the temporary compatibility boundary, so Phase 2 evidence cannot overstate completion.
- Type names are consistent: `QueryPriority`, `WritePriority`, `WorkerRequest`, `WorkerResponse`, `WorkerMetrics`, `QueryPort`, and `WriteDataPort` are defined once and reused.
