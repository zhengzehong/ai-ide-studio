# API Stall Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make future API stalls attributable to stable logical operations without changing application behavior, response contracts, or database state.

**Architecture:** Add a process-local operation diagnostics tracker with separate async activity and synchronous invocation records. Feed its bounded snapshot into the API event-loop monitor, classify Worker callback delivery delay separately from Worker execution, and add recovery-query phase metrics.

**Tech Stack:** TypeScript 6, Node.js performance APIs, Pino, Vitest.

**Spec:** User-approved bounded design in session `sess-72f5b313`.

## Global Constraints

- No database migration or persisted diagnostic data.
- Stable `operationModule` and `operation` names; no source line numbers.
- Diagnostics must not alter return values, exception propagation, or operation ordering.
- PRD service remains running and is not restarted during implementation or merge.

---

### Task 1: Operation diagnostics tracker and event-loop attribution

**Files:**
- Create: `src/shared/operation-diagnostics.ts`
- Create: `tests/unit/operation-diagnostics.test.ts`
- Modify: `src/shared/event-loop-monitor.ts`
- Modify: `tests/unit/event-loop-monitor.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `trackAsyncOperation()`, `trackSyncOperation()`, `trackSyncInvocation()`, and `operationDiagnosticsContext()`.
- Event-loop warnings include bounded `activeOperations` and `recentSyncOperations` snapshots.

- [x] Write tests proving bounded snapshots, exception transparency, and max-delay warnings.
- [x] Run the tests and verify they fail for missing behavior.
- [x] Implement the tracker and `eventLoopMaxMs` warning threshold.
- [x] Connect the tracker snapshot to the API monitor only.
- [x] Re-run focused tests.

### Task 2: Stable operation coverage at API execution boundaries

**Files:**
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/gateway/http/session-command-routes.ts`
- Modify: `src/gateway/http/query-routes.ts`
- Modify: `src/tools/runtime/tool-runtime.ts`
- Modify: `src/core/rules.ts`
- Modify: relevant unit/integration tests

**Interfaces:**
- Consumes: operation tracker APIs from Task 1.
- Produces stable operation names for RPC dispatch, session commands, response serialization, tool execution/auditing, and rule execution/writes.

- [x] Add failing assertions for operation context and unchanged error behavior.
- [x] Wrap async boundaries as active logical operations.
- [x] Wrap synchronous invocation/serialization/store calls as exact synchronous operations.
- [x] Re-run focused tests.

### Task 3: Worker and recovery phase diagnostics

**Files:**
- Modify: `src/data-worker/observability.ts`
- Modify: `src/queries/worker-query-port.ts`
- Modify: `src/data-worker/writer-worker/client.ts`
- Modify: `src/queries/database-query-port.ts`
- Modify: `tests/unit/worker-rpc-client.test.ts`
- Modify: `tests/integration/query-worker.test.ts`

**Interfaces:**
- Produces: latency classification distinguishing `worker`, `queue`, and `api_delivery`.
- Recovery diagnostics expose `latestSequenceMs`, `eventsMs`, `eventCount`, and total duration in Worker logs.

- [x] Write failing latency-classification and recovery diagnostics tests.
- [x] Implement explicit callback-delay log classification.
- [x] Add recovery phase timing without changing the recovery response.
- [x] Re-run focused tests.

### Task 4: Documentation, verification, review, and PRD merge

**Files:**
- Modify: `docs/architecture/overview.md`

- [x] Document the process-local diagnostic boundary and stable operation naming.
- [x] Run `npm test`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and review the complete diff.
- [ ] Commit the feature branch and merge it into `prd` with `--no-ff` without restarting PRD.
