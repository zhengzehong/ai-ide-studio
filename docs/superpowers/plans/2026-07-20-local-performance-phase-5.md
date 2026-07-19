# Local Performance Architecture Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This task is intentionally executed inline and sequentially; do not delegate it to sub-agents.

**Goal:** Close the local three-process performance architecture with durable HTTP Session commands, stale-while-revalidate browser snapshots, route-level code splitting, controlled SQLite maintenance, and reproducible 30-Session performance/failure gates.

**Architecture:** Browser Query and the five latency-sensitive Session commands use HTTP, while WebSocket remains the subscription/event transport. IndexedDB supplies bounded stale snapshots before network bootstrap, then the existing project caches revalidate. SQLite maintenance stays owned by the Writer Worker, and event-loop/soak gates verify that API, Realtime, and Runtime remain isolated under load.

**Tech Stack:** TypeScript 6, Hono, React 19, Zustand, native IndexedDB, Node worker_threads/child_process, better-sqlite3 WAL, Vitest, Vite, Playwright browser smoke tests.

---

## Scope And Compatibility Decisions

1. HTTP Command is a closed discriminated union, not an arbitrary RPC tunnel. Phase 5 migrates `prompt`, `session.cancel`, `sessions.markRead`, `permission.respond`, and `elicitation.respond`; `VITE_COMMAND_TRANSPORT=ws` is the explicit browser rollback.
2. Every HTTP command has `commandId` and `Idempotency-Key`. The Writer-owned command ledger is committed before dispatch. Startup replays only accepted commands and running Prompt commands whose `clientMessageId` has not produced a human message. A running Prompt with a persisted human message is marked interrupted instead of being duplicated.
3. Existing Session command functions become shared service functions used by both HTTP and legacy WS handlers. No second domain implementation and no fake WebSocket context are introduced.
4. IndexedDB snapshots are display accelerators, never authority. Hydrated cache entries are immediately marked stale/invalidated, capped at five projects, schema-versioned, size-bounded, and reconciled against the fresh project list.
5. The initial snapshot covers Projects, Task/Agent/Session lists, and the last active Session messages. Filesystem, knowledge, rules, event-center payloads, permissions, and live streaming state continue to come from HTTP/WS to avoid persisting large or security-sensitive transient data.
6. Route modules are lazy loaded behind one stable application shell. Hashed assets receive one-year immutable caching; `index.html`, SPA fallbacks, and unhashed files never receive immutable caching.
7. Writer maintenance may checkpoint WAL, run `PRAGMA optimize`, and delete already-published Outbox rows after retention. It must not delete Session messages/events or other recoverable user history without a product retention policy.
8. One API process, one Realtime process, one Runtime process, one Query Worker, and one Writer Worker remain the default. No Runtime shard, broker, Rust rewrite, or Query/Command process split is added.

## File Map

### HTTP Commands

- Create `src/commands/session-command-types.ts`: clone-safe command union, result/status types, and validation helpers.
- Create `src/commands/session-command-service.ts`: shared Session command execution used by HTTP and legacy WS.
- Create `src/commands/runtime-command-dispatcher.ts`: durable intake, accepted-command replay, per-Session ordering, lifecycle, and drain.
- Create `src/gateway/http/session-command-routes.ts`: authenticated `/api/v1/commands` endpoint with body/deadline/size handling.
- Create `ui/src/services/command-client.ts`: HTTP client plus explicit legacy WS adapter and transport selection.
- Modify `src/ports/write-data-port.ts`, `src/data-worker/writer-worker/entry.ts`, `src/data-worker/writer-worker/operations.ts`, `src/data-worker/writer-worker/client.ts`, and `src/core/persistence/local-write-data-port.ts`: command-ledger operations.
- Modify `src/gateway/rpc/subscriptions.ts`, `src/gateway/rpc/sessions.ts`, `src/gateway/server.ts`, `src/app.ts`, `ui/src/stores/session.store.ts`, and `ui/src/stores/global-assistant.store.ts`: share execution and migrate hot browser commands.
- Create `src/store/migrations/044-runtime-command-ledger.ts` and register it in `src/store/migrations/index.ts`.
- Test `tests/unit/session-command-types.test.ts`, `tests/integration/runtime-command-ledger.test.ts`, `tests/integration/http-session-commands.test.ts`, and `tests/unit/command-client.test.ts`.

### Browser Bootstrap And Startup

- Create `ui/src/services/bootstrap-snapshot-storage.ts`: native IndexedDB adapter and injectable storage contract.
- Create `ui/src/project-scope/bootstrap-snapshot.ts`: schema validation, stale hydration, bounded export, debounce persistence, and reconcile cleanup.
- Create `ui/src/routes/lazy-pages.tsx`: named/default export adapters for lazy route modules.
- Create `scripts/check-ui-bundle.mjs`: assert the entry chunk stays within budget and route chunks exist.
- Modify `ui/src/main.tsx`, `ui/src/App.tsx`, `ui/src/stores/project.store.ts`, `ui/src/stores/session.store.ts`, `ui/src/project-scope/project-data-scope.ts`, `ui/vite.config.ts`, `src/gateway/static-assets.ts`, and root `package.json`.
- Test `tests/unit/bootstrap-snapshot.test.ts`, `tests/unit/bootstrap-snapshot-storage.test.ts`, `tests/unit/static-assets.test.ts`, and `tests/unit/ui-route-splitting.test.ts`.

### SQLite Maintenance And Observability

- Create `src/store/migrations/045-performance-covering-indexes.ts` only for indexes proven necessary by `EXPLAIN QUERY PLAN`.
- Create `src/data-worker/writer-worker/maintenance.ts`: idle-only passive/truncate checkpoint policy, optimize, published-Outbox retention, and metrics.
- Create `src/shared/event-loop-monitor.ts`: p50/p95/p99/max lag, event-loop utilization, and memory snapshots with structured logging.
- Modify Writer Port/client/entry, `src/app.ts`, `src/core/config.ts`, `src/realtime/service.ts`, and `src/runtime/service/entry.ts` for maintenance/monitor lifecycle.
- Test `tests/integration/query-plan-indexes.test.ts`, `tests/integration/writer-maintenance.test.ts`, and `tests/unit/event-loop-monitor.test.ts`.

### Final Performance And Failure Gates

- Create `scripts/performance/phase-5-soak.ts`: configurable 30-Session soak runner; 30 minutes by default and a short CI smoke mode.
- Create `scripts/performance/browser-startup.mjs`: production-build browser gate for hard refresh and cached route/project switch.
- Create `tests/integration/phase-5-process-failures.test.ts`: Query/Writer/Realtime/Runtime kill/restart isolation and command recovery.
- Create `tests/integration/phase-5-performance.test.ts`: 30 Session, injected slow Query, latency, exactly-once done, queue drain, and memory trend assertions.
- Modify `docs/architecture/overview.md`, `docs/architecture/ws-protocol.md`, `docs/architecture/data-model.md`, `docs/guides/testing.md`, and `README.md`.

## Task 1: Durable Closed HTTP Session Commands

- [ ] **Step 1: Write command contract and validation RED tests**

Define the wished-for public API in `tests/unit/session-command-types.test.ts`:

```ts
const parsed = parseSessionCommand({
  commandId: 'cmd-1',
  type: 'prompt',
  sessionId: 'session-1',
  clientMessageId: 'msg-1',
  content: 'hello',
})
expect(parsed).toMatchObject({ type: 'prompt', commandId: 'cmd-1' })
expect(() => parseSessionCommand({ type: 'tasks.list' })).toThrow('不支持的命令')
```

Cover all five command shapes, missing IDs, empty Prompt, invalid image payload, body size, and forbidden unknown fields.

- [ ] **Step 2: Run contract RED**

Run: `npx vitest run tests/unit/session-command-types.test.ts`

Expected: FAIL because `session-command-types.ts` does not exist.

- [ ] **Step 3: Implement the closed command union**

Use a discriminated union with these exact `type` values:

```ts
type SessionCommand =
  | { commandId: string; type: 'prompt'; sessionId: string; clientMessageId: string; content: string; contextProjectId?: string; images?: ImageAttachment[] }
  | { commandId: string; type: 'session.cancel'; sessionId: string }
  | { commandId: string; type: 'sessions.markRead'; sessionId: string }
  | { commandId: string; type: 'permission.respond'; sessionId: string; permissionRequestId: string; optionId?: string; cancelled?: boolean }
  | { commandId: string; type: 'elicitation.respond'; sessionId: string; elicitationRequestId: string; action: 'accept' | 'decline' | 'cancel'; content?: ElicitationContent }
```

Validation returns a clone-safe value and rejects everything outside the allowlist.

- [ ] **Step 4: Write Writer-ledger RED tests**

In `tests/integration/runtime-command-ledger.test.ts`, prove:

- enqueue and status update are Writer transactions;
- duplicate `Idempotency-Key` returns the original `commandId` without executing twice;
- accepted rows survive Worker termination/restart;
- accepted commands are returned in creation order;
- a running Prompt with no persisted human message is recoverable;
- a running Prompt with its `clientMessageId` already in `messages` is interrupted, not replayed.

- [ ] **Step 5: Run ledger RED**

Run: `npx vitest run tests/integration/runtime-command-ledger.test.ts`

Expected: FAIL because migration 044 and Writer command operations do not exist.

- [ ] **Step 6: Implement migration and Writer operations**

Create `runtime_commands` with unique `(idempotency_key, type)`, indexed `status/created_at`, JSON payload, attempts, and timestamps. Extend `WriteDataPort` with typed `enqueueCommand`, `claimRecoverableCommands`, and `completeCommand`; Worker operations use parameterized SQL and never accept arbitrary SQL.

- [ ] **Step 7: Write shared service/dispatcher RED tests**

Test per-Session FIFO with cross-Session concurrency, accepted replay, Prompt fire-and-observe completion, non-Prompt request completion, error persistence, and drain. Inject command executors and ledger ports instead of mocking internal functions.

- [ ] **Step 8: Run dispatcher RED**

Run: `npx vitest run tests/unit/runtime-command-dispatcher.test.ts`

Expected: FAIL because the dispatcher does not exist.

- [ ] **Step 9: Implement shared Session command service and dispatcher**

Extract current RPC behavior without changing validation, runtime calls, events, or cancel timeout semantics. Start the dispatcher after Runtime is ready and before Gateway accepts commands; stop intake and drain before Runtime shutdown. Recovery follows the Scope Decision rule and logs `commandId`, `sessionId`, `type`, attempt, duration, and outcome.

- [ ] **Step 10: Write HTTP route/client RED tests**

Assert owner-token auth, 400 invalid command, 413 oversized body, 202 Prompt acceptance, 200 completed short command, 409 idempotency conflict, 503 closed dispatcher, timeout behavior, token header, command ID propagation, and explicit WS rollback.

- [ ] **Step 11: Run HTTP/client RED**

Run: `npx vitest run tests/integration/http-session-commands.test.ts tests/unit/command-client.test.ts`

Expected: FAIL because the route/client do not exist.

- [ ] **Step 12: Implement HTTP route and browser migration**

Mount before static assets. `commandClient` subscribes to the target Session through existing WS control before an HTTP Prompt, then POSTs JSON with `Idempotency-Key`. Update PC Session and Global Assistant stores only; guest share and mobile remain on their existing transports in this phase.

- [ ] **Step 13: Verify Task 1 and commit**

Run:

```bash
npx vitest run tests/unit/session-command-types.test.ts tests/unit/runtime-command-dispatcher.test.ts tests/unit/command-client.test.ts tests/integration/runtime-command-ledger.test.ts tests/integration/http-session-commands.test.ts tests/integration/runtime-command-parity.test.ts
npx tsc --noEmit
npx tsc --noEmit -p ui/tsconfig.json
git diff --check
```

Commit: `feat(commands): add durable HTTP session command path`

## Task 2: IndexedDB Stale Bootstrap Snapshots

- [ ] **Step 1: Write storage adapter RED tests**

Test open/upgrade, one-record replace, read, delete, unavailable/private-mode fallback, schema mismatch, and a 4 MiB serialized size ceiling using an injected fake IndexedDB factory.

- [ ] **Step 2: Run storage RED**

Run: `npx vitest run tests/unit/bootstrap-snapshot-storage.test.ts`

Expected: FAIL because the storage adapter does not exist.

- [ ] **Step 3: Implement native IndexedDB storage**

Use database `ai-ide-bootstrap`, object store `snapshots`, key `current`, schema version 1. All failures are logged once and treated as cache misses; no localStorage fallback stores large payloads.

- [ ] **Step 4: Write snapshot coordinator RED tests**

Build snapshots containing Projects plus Task/Agent/Session `ProjectCacheState` entries and one active Session message list. Assert hydration completes before render, entries are invalidated, request sequence maps are reset, newest five project scopes survive, corrupt/oversized snapshots are ignored, deleted projects are removed, and persistence is debounced.

- [ ] **Step 5: Run coordinator RED**

Run: `npx vitest run tests/unit/bootstrap-snapshot.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 6: Implement bounded export/hydration**

Expose narrow store snapshot/hydration methods rather than importing private Zustand internals. `main.tsx` awaits snapshot hydration with a 100 ms maximum startup budget, renders immediately on miss/timeout, registers debounced persistence, then `App` starts normal Project/HTTP/WS revalidation.

- [ ] **Step 7: Reconcile lifecycle and deletion**

Project fetch reconciliation removes invalid snapshot scopes. Project deletion clears the in-memory cache and schedules an IndexedDB rewrite. Live/permission/elicitation/streaming state is never serialized.

- [ ] **Step 8: Verify Task 2 and commit**

Run:

```bash
npx vitest run tests/unit/bootstrap-snapshot-storage.test.ts tests/unit/bootstrap-snapshot.test.ts tests/unit/project-cache.test.ts tests/unit/project-data-scope.test.ts
npx tsc --noEmit -p ui/tsconfig.json
git diff --check
```

Commit: `feat(ui): hydrate bounded project snapshots from indexeddb`

## Task 3: Route Splitting And Static Cache Policy

- [ ] **Step 1: Write route/cache RED tests**

Assert `App.tsx` has no eager page imports, each route is represented by a dynamic import, the shell has one Suspense fallback, hashed `/assets/name-<hash>.js|css` is immutable, and HTML/SPA/unhashed assets are `no-cache`.

- [ ] **Step 2: Run route/cache RED**

Run: `npx vitest run tests/unit/ui-route-splitting.test.ts tests/unit/static-assets.test.ts`

Expected: FAIL on eager imports and missing cache policy.

- [ ] **Step 3: Implement lazy route registry and cache middleware**

Keep authentication, connection bootstrap, `AppLayout`, and project-scope routing in the entry shell. Lazy-load every page. Apply cache headers after static resolution so SPA fallback HTML cannot inherit immutable caching.

- [ ] **Step 4: Add bundle budget gate**

Build with Vite manifest enabled. `scripts/check-ui-bundle.mjs` requires at least one chunk per major route and an entry JavaScript chunk below 350 KiB uncompressed; it reports all chunk sizes on failure.

- [ ] **Step 5: Verify Task 3 and commit**

Run:

```bash
npm run build -w ui
npm run check:ui-bundle
npx vitest run tests/unit/ui-route-splitting.test.ts tests/unit/static-assets.test.ts
git diff --check
```

Commit: `perf(ui): split routes and cache hashed assets`

## Task 4: Writer-Owned SQLite Maintenance

- [ ] **Step 1: Write EXPLAIN and maintenance RED tests**

Populate realistic Tasks/Sessions/Messages/Events, run the four Query Worker hot reads through `EXPLAIN QUERY PLAN`, and reject temp B-tree/full scans where an indexed lookup is required. Test that maintenance waits for Writer drain, skips checkpoint below threshold, checkpoints above threshold, force-checkpoints on shutdown, runs optimize, deletes only old `published_at IS NOT NULL` Outbox rows, and leaves Session history untouched.

- [ ] **Step 2: Run maintenance RED**

Run: `npx vitest run tests/integration/query-plan-indexes.test.ts tests/integration/writer-maintenance.test.ts`

Expected: FAIL because the maintenance Port and any missing covering index do not exist.

- [ ] **Step 3: Add only proven indexes**

Create migration 045 only for query plans that fail Step 1. Prefer covering order matching existing Query Worker SQL; do not add duplicate prefix indexes.

- [ ] **Step 4: Implement Writer maintenance Port**

Add typed `maintain({ force })` to `WriteDataPort`. Worker maintenance runs only after Scheduler drain and returns WAL bytes, checkpoint page counts, deleted published Outbox rows, and elapsed time. Default threshold is 64 MiB, interval 60 s, published Outbox retention 7 days; all are configurable.

- [ ] **Step 5: Integrate lifecycle**

API schedules background maintenance without blocking requests. Shutdown stops the timer, flushes Session persistence, force-maintains, then closes Writer. `DATA_WORKER_MODE=local` preserves the same contract.

- [ ] **Step 6: Verify Task 4 and commit**

Run:

```bash
npx vitest run tests/integration/query-plan-indexes.test.ts tests/integration/writer-maintenance.test.ts tests/integration/data-worker-lifecycle.test.ts
npx tsc --noEmit
git diff --check
```

Commit: `perf(database): add controlled writer maintenance`

## Task 5: Process Observability And Final Gates

- [ ] **Step 1: Write event-loop monitor RED tests**

Inject clock/histogram/logger dependencies. Assert start/stop idempotency, p99 conversion, utilization deltas, memory fields, slow-loop warning threshold, and no timers after close.

- [ ] **Step 2: Run monitor RED**

Run: `npx vitest run tests/unit/event-loop-monitor.test.ts`

Expected: FAIL because the monitor does not exist.

- [ ] **Step 3: Implement and install monitors**

API, Realtime, and Runtime each own one monitor and log their service name, event-loop p50/p95/p99/max, utilization, RSS/heap, and active queue/connection/session counts every 30 seconds. Stop monitors during normal and failed startup cleanup.

- [ ] **Step 4: Write process-failure RED tests**

Kill Query Worker, Writer Worker, Realtime, and Runtime at controlled points. Assert unrelated processes remain responsive, accepted commands recover according to Task 1 semantics, no duplicate `session:done`, Runtime/Realtime restart, Writer failure rejects rather than silently falling back, and a clean app restart reopens the database.

- [ ] **Step 5: Run process-failure RED**

Run: `npx vitest run tests/integration/phase-5-process-failures.test.ts`

Expected: FAIL until test hooks/lifecycle recovery are complete.

- [ ] **Step 6: Implement the soak and browser runners**

`phase-5-soak.ts` accepts `--sessions`, `--duration-ms`, `--sample-ms`, and `--json`; defaults are 30 Sessions/30 minutes. CI smoke uses 30 Sessions/5 seconds. `browser-startup.mjs` serves the production build, seeds a snapshot, and measures `performance.mark` values for bootstrap interactive and cached route/project switches.

- [ ] **Step 7: Run final performance gates**

Required gates:

- cached project/page switch p95 `< 50ms`;
- production hard refresh interactive p95 `< 300ms` on the local warm-cache runner;
- Session History p95 `< 100ms`;
- Runtime event to browser p95 `< 50ms`;
- Realtime event-loop lag p99 `< 20ms`;
- 30 Sessions produce exactly one done each, with no timeout or positive sustained heap-growth slope;
- injected 2-second Query keeps WebSocket p95 `< 50ms`.

Run:

```bash
npx vitest run tests/integration/phase-5-performance.test.ts tests/integration/phase-5-process-failures.test.ts tests/integration/runtime-performance.test.ts tests/integration/realtime-performance.test.ts
npm run perf:phase5:smoke
npm run perf:browser
```

- [ ] **Step 8: Update stable documentation**

Document process/Worker ownership, HTTP Command DTO/status/idempotency, WebSocket control/event role, IndexedDB stale snapshots, cache headers, maintenance configuration, event-loop metrics, and test commands. Architecture documents describe stable structure only; this plan remains the implementation history.

- [ ] **Step 9: Run full verification**

```bash
npm test
npm run build
npm run lint
npm run check:ui-bundle
npm run perf:phase5:smoke
npm run perf:browser
git diff --check 8106802..HEAD
git status --short
```

- [ ] **Step 10: Request review and report Phase 5**

Review range is `8106802..HEAD`. Do not merge `prd` until code-reviewer approves all Phase 5 acceptance items.

Commit: `docs: complete local performance architecture`

## Self-Review

- Spec coverage: HTTP hot commands and durable intake close the Phase 4 deferral; IndexedDB, route splitting, cache policy, Writer maintenance, index review, 30-Session soak, slow Query isolation, browser startup, and kill/restart each map to a task.
- Safety: command parsing is allowlisted; SQL stays parameterized in Writer; snapshot data is bounded and stale; history deletion is forbidden; legacy WS is an explicit rollback, not a silent fallback.
- Ownership: Browser commands enter API; API dispatches Runtime; Runtime streams directly to Realtime; persistence goes to Writer; Realtime never runs domain commands; Writer alone checkpoints SQLite.
- Compatibility: PC hot commands move to HTTP without changing Session semantics; guest/mobile are unchanged; current project routing, Session recovery, and live subscriptions remain intact.
- Non-goals: no all-RPC migration, no second process instance, no Redis, no Rust, no history-retention policy, and no UI redesign.
