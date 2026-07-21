# Project Recovery and Task Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false-empty project views and multi-megabyte Session recovery/Task list responses while preserving realtime tools and on-demand full details.

**Architecture:** Always activate the routed project and deduplicate only background refreshes. Replace PC raw-event recovery with a filtered recovery query plus messages/process summaries, then split Task list summaries from the existing `tasks.get` detail RPC.

**Tech Stack:** TypeScript, React 19, Zustand, Hono, better-sqlite3, Query Worker, Vitest.

---

### Task 1: Fix Project Reactivation Race

**Files:**
- Modify: `ui/src/project-scope/project-data-scope.ts:14-36`
- Modify: `tests/unit/project-data-scope.test.ts:85-128`

- [ ] **Step 1: Write the failing A -> B -> A test**

Keep project A's refresh pending, activate B, then activate A again. Assert Store activation runs for both A visits while A network fetches run once.

```ts
const firstA = activateProjectData('project-a')
await activateProjectData('project-b')
const secondA = activateProjectData('project-a')
expect(stores.agent.activateProject).toHaveBeenLastCalledWith('project-a')
expect(stores.agent.fetchAgents.mock.calls.filter(([id]) => id === 'project-a')).toHaveLength(1)
```

- [ ] **Step 2: Run `npx vitest run tests/unit/project-data-scope.test.ts`**

Expected: FAIL because the second A activation returns before Store activation.

- [ ] **Step 3: Move refresh coalescing after Store activation**

```ts
export function activateProjectData(projectId: string): Promise<void> {
  activateProjectView(projectId)
  const currentRefresh = projectRefreshes.get(projectId)
  if (currentRefresh) return currentRefresh
  const refresh = refreshProjectData(projectId).finally(() => {
    if (projectRefreshes.get(projectId) === refresh) projectRefreshes.delete(projectId)
  })
  projectRefreshes.set(projectId, refresh)
  return refresh
}
```

- [ ] **Step 4: Re-run the test and commit**

```bash
git add ui/src/project-scope/project-data-scope.ts tests/unit/project-data-scope.test.ts
git commit -m "fix(ui): reactivate project stores during refresh"
```

### Task 2: Represent Initial Loading, Failure, and Retry

**Files:**
- Modify: `ui/src/stores/project-cache.ts`
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Test: `tests/unit/project-cache.test.ts`
- Test: `tests/unit/agent-project-cache.test.ts`
- Test: `tests/unit/session-project-cache.test.ts`
- Test: `tests/unit/workspace-session-agent.test.ts`

- [ ] **Step 1: Add failing cold-error tests**

```ts
const started = beginProjectRequest(emptyProjectCache<AgentData[]>(), 'project-a')
const failed = setProjectCacheError(started.state, 'project-a', '加载失败')
expect(readProjectCache(failed, 'project-a')).toMatchObject({ error: '加载失败', loaded: false })
```

- [ ] **Step 2: Run focused cache tests and verify failure**

Run: `npx vitest run tests/unit/project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/session-project-cache.test.ts`

- [ ] **Step 3: Add cache loaded/error state**

Allow a cache entry to represent no successful data yet. Successful commits set `loaded=true`; cold failures create an entry with `loaded=false`, `data=null`, and the error. Existing callers use `entry?.data ?? []`.

- [ ] **Step 4: Expose Store retries and message loading errors**

Add Agent/Session `error` and retry methods. Add `messagesLoadingSessionId` and `messagesErrorBySession`; remove silent `fetchMessages` catches.

- [ ] **Step 5: Render loading/error/true-empty states in Workspace**

```tsx
if (agentInitialLoading) return <WorkspaceAgentLoading />
if (agentError && projectAgents.length === 0) return <WorkspaceLoadError onRetry={retryAgents} />
if (agentLoaded && projectAgents.length === 0) return <WorkspaceEmptyAgents />
```

- [ ] **Step 6: Run focused tests and commit**

```bash
npx vitest run tests/unit/project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/session-project-cache.test.ts tests/unit/workspace-session-agent.test.ts
git add ui/src/stores/project-cache.ts ui/src/stores/agent.store.ts ui/src/stores/session.store.ts ui/src/pages/Workspace.tsx tests/unit/project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/session-project-cache.test.ts tests/unit/workspace-session-agent.test.ts
git commit -m "fix(ui): distinguish project loading from empty state"
```

### Task 3: Add Lightweight Session Recovery Query

**Files:**
- Modify: `src/ports/query-port.ts`
- Modify: `src/store/sessions.ts`
- Modify: `src/queries/database-query-port.ts`
- Modify: `src/queries/worker-query-port.ts`
- Modify: `src/data-worker/query-worker/operations.ts`
- Modify: `src/gateway/http/query-routes.ts`
- Modify: `ui/src/services/query-client.ts`
- Test: `tests/integration/http-query-routes.test.ts`
- Test: `tests/integration/query-transport-parity.test.ts`
- Test: `tests/unit/query-client.test.ts`

- [ ] **Step 1: Add failing recovery contract tests**

```ts
export interface SessionRecoverySnapshot {
  sessionId: string
  latestSequence: number
  events: SessionEventRow[]
}
```

Seed a 1 MiB `tool.update` and essential state events. Assert `/api/v1/sessions/:id/recovery` excludes mirrored events, preserves state events, reports the full-stream sequence, and stays below 256 KiB.

- [ ] **Step 2: Run recovery tests and verify failure**

Run: `npx vitest run tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/unit/query-client.test.ts`

- [ ] **Step 3: Filter in SQLite before LIMIT**

```sql
SELECT * FROM session_events
WHERE session_id = @sessionId
  AND type NOT IN ('message.chunk', 'thinking.chunk', 'tool.call', 'tool.update', 'message.done')
ORDER BY sequence DESC
LIMIT @limit
```

Add `eventStore.latestSequence(sessionId)` so cursor continuity includes excluded events.

- [ ] **Step 4: Wire Query Port, worker, route, and PC client**

Add `getSessionRecovery` to QueryPort, worker operation `sessions.recovery`, `GET /api/v1/sessions/:sessionId/recovery`, and query-client response validation.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/unit/query-client.test.ts
git add src/ports/query-port.ts src/store/sessions.ts src/queries/database-query-port.ts src/queries/worker-query-port.ts src/data-worker/query-worker/operations.ts src/gateway/http/query-routes.ts ui/src/services/query-client.ts tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/unit/query-client.test.ts
git commit -m "perf(query): add lightweight session recovery"
```

### Task 4: Restore Sessions from Messages and Process Summaries

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/app-runtime-bootstrap.ts`
- Test: `tests/unit/app-runtime-bootstrap.test.ts`
- Test: `tests/unit/session-store-done-refresh.test.ts`
- Test: `tests/unit/session-store-prompt-acceptance.test.ts`

- [ ] **Step 1: Add failing recovery behavior tests**

Assert recovery uses `getSessionRecovery`, messages commit without waiting for project refresh, running messages call `fetchMessageProcess`, and cursor advances to `latestSequence`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run tests/unit/app-runtime-bootstrap.test.ts tests/unit/session-store-done-refresh.test.ts`

- [ ] **Step 3: Implement `fetchRecovery(sessionId)`**

Reduce only lightweight state events. Keep legacy `fetchEvents` for explicit history paths. `selectSession` starts messages and recovery independently; a running message restores its process summary through the existing on-demand RPC.

- [ ] **Step 4: Prioritize current Session during Realtime gap**

Start messages/recovery first. Run project refresh as background work so Task/file/knowledge requests do not delay message rendering. Acknowledge resync after recovery and refresh settlement.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/unit/app-runtime-bootstrap.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/session-store-prompt-acceptance.test.ts
git add ui/src/stores/session.store.ts ui/src/app-runtime-bootstrap.ts tests/unit/app-runtime-bootstrap.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/session-store-prompt-acceptance.test.ts
git commit -m "perf(ui): restore sessions without raw tool history"
```

### Task 5: Split Task Summaries from Task Detail

**Files:**
- Modify: `src/ports/query-port.ts`
- Modify: `src/queries/task-list-query.ts`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/TaskBoard.tsx`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/pages/workspace/task-collab/TaskDetailInline.tsx`
- Test: `tests/integration/http-query-routes.test.ts`
- Test: `tests/integration/query-read-model-performance.test.ts`

- [ ] **Step 1: Add failing Task summary tests**

Change `TaskListItem` to omit full description and add a server-generated `descriptionPreview`. Seed long descriptions and assert the list contains the preview but not the full text; assert 262 Task response is below 512 KiB.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run tests/integration/http-query-routes.test.ts tests/integration/query-read-model-performance.test.ts`

- [ ] **Step 3: Build summaries server-side**

```ts
function taskDescriptionPreview(value: string | null): string | null {
  if (!value) return null
  return value.length <= 240 ? value : `${value.slice(0, 239)}…`
}
```

Keep step summaries and latest report previews, but never include complete description/report bodies in list responses.

- [ ] **Step 4: Load existing `tasks.get` detail on demand**

Add `taskDetailsById`, detail loading/error state, and `fetchTaskDetail(taskId)`. TaskBoard and Workspace fetch detail when opening the panel and retain the summary on failure.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/integration/http-query-routes.test.ts tests/integration/query-read-model-performance.test.ts
git add src/ports/query-port.ts src/queries/task-list-query.ts ui/src/stores/task.store.ts ui/src/pages/TaskBoard.tsx ui/src/pages/Workspace.tsx ui/src/pages/workspace/task-collab/TaskDetailInline.tsx tests/integration/http-query-routes.test.ts tests/integration/query-read-model-performance.test.ts
git commit -m "perf(tasks): load full task details on demand"
```

### Task 6: Documentation, Full Verification, and Review

**Files:**
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/guides/testing.md`
- Modify: `README.md`

- [ ] **Step 1: Document project activation, recovery read model, and Task summary/detail**

- [ ] **Step 2: Run focused verification**

```bash
npx tsc --noEmit
npx vitest run tests/unit/project-data-scope.test.ts tests/unit/project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/session-project-cache.test.ts tests/unit/app-runtime-bootstrap.test.ts tests/unit/query-client.test.ts tests/integration/http-query-routes.test.ts tests/integration/query-transport-parity.test.ts tests/integration/query-read-model-performance.test.ts
```

- [ ] **Step 3: Run mandatory full validation**

```bash
npm test
npm run lint
npm run build
git diff --check prd..HEAD
```

- [ ] **Step 4: Run an isolated browser smoke test**

Use a non-PRD port and independent DATA_DIR. Verify A -> B -> A, message-first display, running tool recovery, full detail expansion, and Task list/detail. Do not use 18900 or data-prd.

- [ ] **Step 5: Commit docs and request code review**

```bash
git add docs/architecture/overview.md docs/architecture/ws-protocol.md docs/guides/testing.md README.md
git commit -m "docs: describe lightweight recovery read models"
```

Send branch, worktree, base/head commits, acceptance criteria, test outputs, and response-size evidence to `code-reviewer`. Do not merge `prd` without user approval.

