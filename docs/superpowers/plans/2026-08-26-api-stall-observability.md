# API Stall Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the next API stall attributable to Worker execution, Worker response delivery, HTTP serialization, or a named synchronous SQLite operation without changing production behavior.

**Architecture:** Extend the shared Worker RPC boundary with client-observed timing and bounded late-response tombstones, then expose those metrics through existing Writer and Query logs. Add phase timing to HTTP query responses and a small synchronous-operation observer used only by the confirmed API write hotspots. Normal operations remain debug-level; only slow or late operations emit warnings.

**Tech Stack:** TypeScript, Node.js worker_threads, better-sqlite3, Hono, Pino, Vitest.

---

### Task 1: Worker response delivery diagnostics

**Files:**
- Modify: `src/data-worker/protocol.ts`
- Modify: `src/data-worker/worker-rpc-client.ts`
- Modify: `src/data-worker/writer-worker/client.ts`
- Modify: `src/queries/worker-query-port.ts`
- Test: `tests/unit/worker-rpc-client.test.ts`

- [x] Add failing tests proving successful responses expose client-observed and delivery-lag timing.
- [x] Add a failing test proving a response arriving after timeout is reported through a bounded late-response callback.
- [x] Extend Worker call metrics without changing the Worker wire response.
- [x] Retain only timeout tombstones, expire them, and clear them during shutdown.
- [x] Include delivery timing in slow Writer and Query logs.

### Task 2: HTTP query phase diagnostics

**Files:**
- Modify: `src/gateway/http/query-routes.ts`
- Test: `tests/integration/http-query-routes.test.ts`

- [x] Add failing assertions for `queryMs`, `serializeMs`, `totalMs`, and response bytes in `Server-Timing`.
- [x] Measure query execution and JSON serialization separately.
- [x] Preserve existing status/error mapping and response shape.

### Task 3: Named synchronous SQLite operation diagnostics

**Files:**
- Create: `src/store/db-operation-observer.ts`
- Modify: `src/commands/session-command-service.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/core/timeline.ts`
- Modify: `src/core/tasks.ts`
- Test: `tests/unit/db-operation-observer.test.ts`

- [x] Add failing tests for slow-operation warnings, error metadata, and fast-operation debug logging.
- [x] Implement a synchronous observer that logs operation name, duration, safe context, and SQLite error code without SQL values or message content.
- [x] Instrument confirmed API hot writes: markRead, prompt message/event start writes, ACP Session mapping, Timeline apply, and Task report writes.
- [x] Keep return values and thrown errors unchanged.

### Task 4: Verification and integration

**Files:**
- Modify: `docs/architecture/overview.md` only if the diagnostics boundary changes architecture documentation materially.

- [x] Run focused observability, Worker, HTTP, Session, Timeline, and Task tests.
- [x] Run `npm test` (all 1822 assertions pass; Vitest still reports the 32 pre-existing asynchronous task-dispatch cleanup errors reproduced on the base branch).
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect the complete diff for secrets, noisy payload logs, and unrelated changes.
- [ ] Commit the feature branch and merge it into `prd` without restarting the running PRD service.
