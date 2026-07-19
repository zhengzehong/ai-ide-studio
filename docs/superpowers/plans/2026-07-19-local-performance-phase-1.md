# Local Performance Architecture Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the first PC read hot paths from WebSocket RPC to versioned HTTP through an asynchronous Query Port, while reducing synchronous SQLite query amplification and preserving WS compatibility for mobile and rollback.

**Architecture:** A `QueryPort` owns task, session, message-history, and recovery-event reads. Phase 1 uses an in-process adapter over optimized SQLite read models; HTTP routes and legacy WS RPC handlers call the same port, so Phase 2 can replace the adapter with a Query Worker without changing callers. The PC query client uses HTTP by default, supports `VITE_QUERY_TRANSPORT=ws` rollback, and leaves mobile untouched.

**Tech Stack:** TypeScript 6, Hono, better-sqlite3, React 19, Zustand 5, Vitest 4.

---

## File Map

- Create `src/ports/query-port.ts`: transport-neutral async query inputs, page metadata, and result DTOs.
- Create `src/queries/task-list-query.ts`: fixed-query-count task list projection.
- Create `src/queries/local-query-port.ts`: in-process `QueryPort` implementation and singleton provider.
- Create `src/gateway/http/query-routes.ts`: authenticated `/api/v1` read endpoints, validation, timing, and response-size logging.
- Create `src/store/migrations/042-query-read-model-indexes.ts`: indexes for runtime-state and task projections.
- Modify `src/store/migrations/index.ts`: register migration 042.
- Modify `src/store/sessions.ts`: bulk task/session helpers and one-statement runtime signal projection.
- Modify `src/store/task-events.ts`: bulk linked-session lookup.
- Modify `src/store/task-steps.ts`: bulk step and dependency lookup.
- Modify `src/gateway/server.ts`: mount versioned query routes; keep old unversioned routes unchanged.
- Modify `src/gateway/rpc/tasks.ts`: make `tasks.list` a Query Port compatibility adapter.
- Modify `src/gateway/rpc/sessions.ts`: make the four migrated session reads Query Port compatibility adapters.
- Create `ui/src/services/query-client.ts`: typed HTTP client plus explicit WS rollback adapter.
- Modify `ui/src/stores/task.store.ts`: use `queryClient.listTasks`.
- Modify `ui/src/stores/session.store.ts`: use query client for list, message pages, and recovery events.
- Modify `ui/src/stores/global-assistant.store.ts`: use query client for message and event history.
- Modify `ui/src/pages/dashboard/dashboard-session-context.tsx`: use query client for session messages.
- Modify `ui/src/project-scope/project-data-scope.ts`: coalesce concurrent activation waves.
- Modify `ui/src/pages/Workspace.tsx`: remove project-scope task/session/agent duplicate initial fetch effect.
- Modify `ui/src/pages/TaskBoard.tsx`: remove task/mode duplicate initial fetch effect.
- Create `tests/integration/query-read-model-performance.test.ts`: parity and constant query-count coverage.
- Create `tests/integration/http-query-routes.test.ts`: HTTP contract, auth, pagination, and observability coverage.
- Create `tests/unit/query-client.test.ts`: URL, token, page DTO, errors, timeout, and rollback coverage.
- Modify `tests/unit/project-data-scope.test.ts`: concurrent activation coalescing coverage.
- Modify `docs/architecture/overview.md`, `docs/architecture/ws-protocol.md`, and `README.md`: document the transitional HTTP/WS boundary and rollback switch.

## Task 1: Async Query Port And Fixed-Count Read Models

**Files:**
- Create: `src/ports/query-port.ts`
- Create: `src/queries/task-list-query.ts`
- Create: `src/queries/local-query-port.ts`
- Create: `src/store/migrations/042-query-read-model-indexes.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/sessions.ts:173-219,393-474`
- Modify: `src/store/task-events.ts:76-97`
- Modify: `src/store/task-steps.ts:186-217`
- Test: `tests/integration/query-read-model-performance.test.ts`

- [ ] **Step 1: Write failing Query Port contract and performance tests**

Create real-database tests that seed at least 30 tasks/sessions, call the desired async API, and assert:

```ts
const tasks = await localQueryPort.listTasks({ projectId })
expect(tasks[0]).toMatchObject({
  sessionId: expect.any(String),
  steps: expect.any(Array),
  stepProgress: { done: expect.any(Number), total: expect.any(Number) },
})
expect(prepareSpy.mock.calls.length).toBeLessThanOrEqual(7)

const sessions = await localQueryPort.listSessions({ projectId })
expect(sessions.filter((item) => item.activity_state === 'running')).toHaveLength(3)
expect(prepareSpy.mock.calls.length).toBe(1)
```

Also assert message paging returns `items`, `hasMore`, and the oldest returned timestamp as `nextCursor`, while event paging after a sequence returns the earliest next page in ascending sequence order.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/integration/query-read-model-performance.test.ts`

Expected: FAIL because `src/ports/query-port.ts` and `src/queries/local-query-port.ts` do not exist.

- [ ] **Step 3: Define the async contract**

Define the transport-neutral surface:

```ts
export interface QueryPage<T> {
  items: T[]
  hasMore: boolean
  nextCursor: string | null
}

export interface QueryPort {
  listTasks(input: { projectId?: string; status?: string }): Promise<TaskListItem[]>
  listSessions(input: { projectId?: string; agentId?: string }): Promise<SessionListRow[]>
  listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageRow>>
  listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventRow>>
}
```

Bounds are explicit: message limit defaults to 100 and clamps to `1..200`; event limit defaults to 500 and clamps to `1..1000`.

- [ ] **Step 4: Implement fixed-count task and session projections**

Add bulk store methods using parameterized `IN (...)` queries. Build the task projection from a constant number of reads: task rows, latest report rows, steps, dependencies, direct sessions, linked-session events, and linked session existence. Preserve the current ordering and `sessionId` selection behavior.

Replace per-session `hasRunningAgentMessage` and `hasRunningProcessItem` calls in `listWithRuntimeState` with one statement containing indexed `EXISTS` projections, then apply the existing `resolveSessionRuntimeState` function in JavaScript.

- [ ] **Step 5: Add read-model indexes**

Migration 042 creates these idempotent indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_messages_session_role_status
  ON messages(session_id, role, status);
CREATE INDEX IF NOT EXISTS idx_turn_process_items_session_status
  ON turn_process_items(session_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_task_started
  ON sessions(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_task_events_type_task_sequence
  ON task_events(type, task_id, sequence);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_created
  ON tasks(project_id, status, created_at DESC);
```

- [ ] **Step 6: Implement the in-process adapter and page semantics**

`localQueryPort` wraps synchronous read models in async methods. Message pages fetch `limit + 1`, discard only the extra oldest row, and expose a cursor. Event pages with `afterSequence` fetch the earliest following events so repeated requests cannot skip a gap; initial recovery still returns the latest bounded window in ascending sequence order.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run tests/integration/query-read-model-performance.test.ts tests/integration/session-history-lightweight.test.ts tests/unit/task-events-rpc.test.ts`

Expected: all tests PASS; task query preparation count remains constant as seeded task count grows.

- [ ] **Step 8: Commit the read boundary**

```bash
git add src/ports src/queries src/store tests/integration/query-read-model-performance.test.ts
git commit -m "perf: add async query read models"
```

## Task 2: Versioned HTTP Query Routes

**Files:**
- Create: `src/gateway/http/query-routes.ts`
- Modify: `src/gateway/server.ts:28-56`
- Test: `tests/integration/http-query-routes.test.ts`

- [ ] **Step 1: Write failing HTTP contract tests**

Start a real gateway on port 0 and verify:

```ts
const response = await fetch(`${baseUrl()}/api/v1/tasks?projectId=${projectId}`, {
  headers: { 'x-ai-ide-token': 'local-secret' },
})
expect(response.status).toBe(200)
expect(await response.json()).toEqual({ data: expect.any(Array) })
expect(response.headers.get('server-timing')).toMatch(/^query;dur=/)
expect(Number(response.headers.get('x-response-bytes'))).toBeGreaterThan(0)
```

Cover all four endpoints, missing token `401`, invalid integer/boolean query values `400`, missing session parity, message cursor metadata, event `afterSequence`, and `Cache-Control: no-store`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/integration/http-query-routes.test.ts`

Expected: FAIL with HTTP 404 for `/api/v1/tasks`.

- [ ] **Step 3: Implement and mount the routes**

Mount:

```text
GET /api/v1/tasks
GET /api/v1/sessions
GET /api/v1/sessions/:sessionId/messages
GET /api/v1/sessions/:sessionId/events
```

Every handler validates query parameters, awaits `QueryPort`, returns `{ data }` or `{ data, page: { hasMore, nextCursor } }`, and emits structured debug timing. Responses larger than the 1 MiB observation budget log a warning with route, item count, elapsed time, and byte count, but are not truncated in Phase 1.

- [ ] **Step 4: Run focused HTTP tests and verify GREEN**

Run: `npx vitest run tests/integration/http-query-routes.test.ts tests/integration/http-mcp-tool-platform.test.ts tests/integration/bridge-callback.test.ts`

Expected: all tests PASS and existing HTTP/MCP auth behavior is unchanged.

- [ ] **Step 5: Commit the HTTP slice**

```bash
git add src/gateway/http/query-routes.ts src/gateway/server.ts tests/integration/http-query-routes.test.ts
git commit -m "feat: expose versioned HTTP query routes"
```

## Task 3: Legacy WebSocket Compatibility Adapters

**Files:**
- Modify: `src/gateway/rpc/tasks.ts:35-50`
- Modify: `src/gateway/rpc/sessions.ts:269-275,363-370,426-428`
- Test: `tests/integration/query-transport-parity.test.ts`

- [ ] **Step 1: Write failing transport parity tests**

Seed tasks, sessions, messages, and events once. Compare HTTP response `data` to the matching WS handler result for:

```ts
expect(wsTasks).toEqual(httpTasks.data)
expect(wsSessions).toEqual(httpSessions.data)
expect(wsMessages).toEqual(httpMessages.data)
expect(wsEvents).toEqual(httpEvents.data)
```

The parity test must include project/agent filters, lightweight tool-call behavior, and event `afterSequence`.

- [ ] **Step 2: Run parity tests and verify RED**

Run: `npx vitest run tests/integration/query-transport-parity.test.ts`

Expected: FAIL because legacy handlers still own independent synchronous implementations and event paging semantics differ.

- [ ] **Step 3: Convert legacy handlers into async adapters**

Each migrated handler only translates its existing message fields to `QueryPort`, awaits the result, and calls `sendResult`. Page endpoints send `page.items` to preserve the historical WS array response. No mobile source file changes.

- [ ] **Step 4: Run parity and existing RPC tests**

Run: `npx vitest run tests/integration/query-transport-parity.test.ts tests/integration/session-history-lightweight.test.ts tests/unit/task-events-rpc.test.ts tests/unit/task-rpc.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit the compatibility layer**

```bash
git add src/gateway/rpc tests/integration/query-transport-parity.test.ts
git commit -m "refactor: route legacy WS reads through query port"
```

## Task 4: PC HTTP Query Client And Store Migration

**Files:**
- Create: `ui/src/services/query-client.ts`
- Modify: `ui/src/stores/task.store.ts:1-3,221-280`
- Modify: `ui/src/stores/session.store.ts:1-3,840-1050`
- Modify: `ui/src/stores/global-assistant.store.ts:441-490`
- Modify: `ui/src/pages/dashboard/dashboard-session-context.tsx:60-78`
- Test: `tests/unit/query-client.test.ts`

- [ ] **Step 1: Write failing HTTP client tests**

Use an injected fake `fetch` to verify exact paths, URL encoding, `x-ai-ide-token`, `Accept: application/json`, response-envelope parsing, server error propagation, and abort timeout. Verify the WS adapter emits the existing RPC message shapes. The production selector must choose HTTP unless `VITE_QUERY_TRANSPORT=ws`; Vitest may explicitly use the WS adapter so existing store tests remain deterministic.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/query-client.test.ts`

Expected: FAIL because `ui/src/services/query-client.ts` does not exist.

- [ ] **Step 3: Implement typed HTTP and rollback clients**

The public interface is domain-specific:

```ts
export interface QueryClient {
  listTasks(input: TaskListQuery): Promise<TaskData[]>
  listSessions(input: SessionListQuery): Promise<SessionData[]>
  listSessionMessages(input: SessionMessageQuery): Promise<QueryPage<MessageData>>
  listSessionEvents(input: SessionEventQuery): Promise<QueryPage<SessionEventData>>
}
```

Use relative `/api/v1` URLs so Vite proxy, production Gateway, and Electron share configuration. Read the existing access token through `getStoredAccessToken()`; never place it in the URL.

- [ ] **Step 4: Migrate every PC caller of the four reads**

Task/session stores consume domain methods. Message pagination uses server `page.hasMore` instead of guessing from `items.length`. Global Assistant and dashboard session context use the same client. WebSocket remains responsible for subscriptions, commands, and event push. Do not edit `mobile/`.

- [ ] **Step 5: Run client and store regression tests**

Run: `npx vitest run tests/unit/query-client.test.ts tests/unit/task-project-cache.test.ts tests/unit/session-project-cache.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/global-assistant-store.test.ts`

Expected: all tests PASS for HTTP DTO parsing, WS rollback, project cache, message recovery, and stale-response guards.

- [ ] **Step 6: Commit the PC migration**

```bash
git add ui/src tests/unit/query-client.test.ts
git commit -m "perf(ui): move hot reads to HTTP"
```

## Task 5: Duplicate Fetch Reduction, Documentation, And Phase Verification

**Files:**
- Modify: `ui/src/project-scope/project-data-scope.ts:11-62`
- Modify: `ui/src/pages/Workspace.tsx:522-527`
- Modify: `ui/src/pages/TaskBoard.tsx:58-61`
- Modify: `tests/unit/project-data-scope.test.ts`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md`

- [ ] **Step 1: Write a failing duplicate-activation test**

Call `activateProjectData('project-a')` twice before the first refresh settles. Assert every scoped fetch is invoked once and both promises settle from the same activation wave.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/unit/project-data-scope.test.ts`

Expected: FAIL because each call currently starts a new ten-request project refresh wave.

- [ ] **Step 3: Coalesce activation and remove page duplicates**

Track an in-flight activation promise per project, synchronously activate caches once, and remove it in `finally`. Remove the Workspace initial agent/session/task effect and TaskBoard initial task/mode effect because `ProjectScopeLayout` owns project activation. Keep event-driven refreshes and non-project Dashboard loading unchanged.

- [ ] **Step 4: Update stable documentation**

Document that Phase 1 PC task/session/history queries use `/api/v1`, WS RPC remains a compatibility bridge, commands and the remaining reads migrate in later phases, and `VITE_QUERY_TRANSPORT=ws` is the rollback switch. Document `Server-Timing`, response-size headers, page bounds, and the rule that mobile remains on WS compatibility until its own migration.

- [ ] **Step 5: Run focused and full verification**

Run in order:

```bash
npx vitest run tests/integration/query-read-model-performance.test.ts tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/unit/query-client.test.ts tests/unit/project-data-scope.test.ts
npm test
npm run build
npm run lint
git diff --check
```

Expected: focused tests PASS; full suite reports at least the 184-file/990-test baseline plus new cases; build and lint exit 0; diff check has no output.

- [ ] **Step 6: Verify scope and commit Phase 1**

Run:

```bash
git diff 27356d2..HEAD -- mobile/
git status --short
```

Expected: no `mobile/` diff and no untracked implementation files after the final commit.

```bash
git add docs README.md tests ui/src src
git commit -m "docs: document phase one query architecture"
```

Do not merge `feat/local-performance-architecture` into `prd`. Report Phase 1 with commits, verification evidence, query-count deltas, known limitations, and the Phase 2 entry conditions.
