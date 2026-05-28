# Session Management Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Session management usable and consistent by adding project-scoped listing/creation, stable titles, rename/delete/close RPCs, and safer fork/create behavior.

**Architecture:** Keep the current SQLite + Core manager + WS RPC + Zustand flow. Add small, focused store/core methods for Session metadata instead of putting SQL in the gateway. Use soft delete for user deletion so history is recoverable and related `messages` / `session_events` remain intact.

**Tech Stack:** TypeScript 6, Vitest, better-sqlite3, Hono/ws, React 19, Zustand.

---

## File Structure

- Modify `src/store/db.ts`: add migration columns for Session metadata (`title`, `updated_at`, `last_message_at`, `archived_at`, `deleted_at`).
- Modify `src/store/sessions.ts`: extend `SessionRow`, create/list/update metadata methods, touch timestamps, soft delete.
- Modify `src/core/sessions.ts`: accept explicit `projectId`, expose rename/delete/archive/close operations, save generated title from ACP `sessionInfo` when title is empty.
- Modify `src/gateway/ws-handler.ts`: wire `projectId` filters and Session RPCs; fix `sessions.create` response; preserve `project_id` on fork.
- Modify `src/types/ws-protocol.ts`: add Session metadata RPC types and server event type.
- Modify `src/core/events.ts`: add `session:changed` event for list metadata updates.
- Modify `ui/src/stores/session.store.ts`: carry Session metadata, add rename/delete/close/archive methods, pass `projectId`, update local lists from `session:changed`.
- Modify `ui/src/stores/agent.store.ts`: support project-scoped list.
- Modify `ui/src/stores/task.store.ts`: support project-scoped list/create.
- Modify `ui/src/pages/Workspace.tsx`: fetch project-scoped data, pass `projectId` on create, show titles, add Session action menu.
- Add `tests/integration/session-management-rpc.test.ts`: WS tests for create/list/rename/delete/project filter.
- Modify `tests/integration/ws-fork.test.ts`: assert fork preserves `project_id` and passes project context.
- Update `docs/architecture/ws-protocol.md`, `docs/architecture/data-model.md`, `docs/architecture/overview.md`, and `README.md` for new capabilities.

---

### Task 1: Backend Session metadata schema/store

**Files:**
- Modify: `src/store/db.ts`
- Modify: `src/store/sessions.ts`
- Test: `tests/integration/session-management-rpc.test.ts`

- [ ] **Step 1: Write failing store/RPC tests**

Create `tests/integration/session-management-rpc.test.ts` with tests that expect:

```ts
import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { acpHost } from '../../src/acp/host.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-management-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

function createWs() {
  const handlers = new Map<string, (raw?: unknown) => unknown>()
  const sent: string[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    send(payload: string) { sent.push(payload) },
    on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
  } as unknown as WebSocket
  handleWsConnection(ws, {} as never, {} as WebSocketServer)
  const onMessage = handlers.get('message')!
  return {
    sent,
    send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))),
    last: () => JSON.parse(sent.at(-1) || '{}') as { type: string; requestId?: string; data?: unknown; message?: string },
  }
}
```

Add tests:

```ts
test('sessions.create returns full persisted row with project metadata', async () => {
  const project = projectStore.create({ name: '项目 A', workDir: resolve(tmp, 'project-a') })
  const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock', projectId: project.id })
  const originalIsRunning = acpHost.isRunning
  const originalStartAgent = acpHost.startAgent
  const originalNewSession = acpHost.newSession
  acpHost.isRunning = (() => true) as typeof acpHost.isRunning
  acpHost.startAgent = (async () => undefined) as typeof acpHost.startAgent
  acpHost.newSession = (async (_agentId, ourSessionId) => `acp-${ourSessionId}`) as typeof acpHost.newSession

  try {
    const ws = createWs()
    await ws.send({ type: 'sessions.create', requestId: 'req-create', agentId: agent.id, projectId: project.id })
    const response = ws.last()
    expect(response.type).toBe('result')
    const data = response.data as Record<string, unknown>
    expect(data.id).toMatch(/^sess-/)
    expect(data.agent_id).toBe(agent.id)
    expect(data.project_id).toBe(project.id)
    expect(data.acp_session_id).toBe(`acp-${data.id}`)
    expect(data.status).toBe('active')
    expect(data.started_at).toBeTruthy()
    expect(data.updated_at).toBeTruthy()
  } finally {
    acpHost.isRunning = originalIsRunning
    acpHost.startAgent = originalStartAgent
    acpHost.newSession = originalNewSession
  }
})

test('sessions.list filters by projectId and hides deleted sessions', async () => {
  const projectA = projectStore.create({ name: '项目 A', workDir: resolve(tmp, 'a') })
  const projectB = projectStore.create({ name: '项目 B', workDir: resolve(tmp, 'b') })
  const agentA = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock', projectId: projectA.id })
  const agentB = agentStore.create({ type: 'dev', name: 'Agent B', runtime: 'mock', projectId: projectB.id })
  const keep = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
  const deleted = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
  const other = sessionStore.create({ agentId: agentB.id, projectId: projectB.id })
  sessionStore.delete(deleted.id)

  const ws = createWs()
  await ws.send({ type: 'sessions.list', requestId: 'req-list', projectId: projectA.id })
  const response = ws.last()
  const ids = (response.data as Array<{ id: string }>).map(s => s.id)
  expect(ids).toEqual([keep.id])
  expect(ids).not.toContain(deleted.id)
  expect(ids).not.toContain(other.id)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/session-management-rpc.test.ts`

Expected: FAIL because `projectId` is ignored, `sessions.create` does not return full row, and `sessionStore.delete` does not exist.

- [ ] **Step 3: Implement schema/store metadata**

In `src/store/db.ts`, add safe columns in `migrateAddColumns`:

```ts
safeAdd('sessions', 'title', 'TEXT')
safeAdd('sessions', 'updated_at', 'TEXT')
safeAdd('sessions', 'last_message_at', 'TEXT')
safeAdd('sessions', 'archived_at', 'TEXT')
safeAdd('sessions', 'deleted_at', 'TEXT')
```

In `src/store/sessions.ts`, extend `SessionRow`, set these fields on create, exclude deleted in list, and add:

```ts
updateTitle(id: string, title: string): SessionRow | undefined
updateTitleIfEmpty(id: string, title: string): SessionRow | undefined
archive(id: string): SessionRow | undefined
delete(id: string): SessionRow | undefined
touch(id: string, timestamp?: string): void
```

- [ ] **Step 4: Run test to verify store behavior passes after gateway wiring**

Run: `npm test -- tests/integration/session-management-rpc.test.ts`

Expected after Task 2: PASS.

---

### Task 2: Backend WS/core Session management RPCs

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/ws-handler.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/integration/session-management-rpc.test.ts`

- [ ] **Step 1: Add failing rename/delete tests**

Append tests to `tests/integration/session-management-rpc.test.ts`:

```ts
test('sessions.rename updates title and returns updated session', async () => {
  const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id })
  const ws = createWs()

  await ws.send({ type: 'sessions.rename', requestId: 'req-rename', sessionId: session.id, title: '新的会话标题' })

  const response = ws.last()
  expect(response.type).toBe('result')
  const data = response.data as Record<string, unknown>
  expect(data.id).toBe(session.id)
  expect(data.title).toBe('新的会话标题')
  expect(sessionStore.get(session.id)?.title).toBe('新的会话标题')
})

test('sessions.delete soft deletes session and list no longer returns it', async () => {
  const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id })
  const ws = createWs()

  await ws.send({ type: 'sessions.delete', requestId: 'req-delete', sessionId: session.id })
  expect(ws.last().type).toBe('result')
  expect((ws.last().data as Record<string, unknown>).deleted).toBe(true)
  expect(sessionStore.get(session.id)?.deleted_at).toBeTruthy()

  await ws.send({ type: 'sessions.list', requestId: 'req-list-after-delete' })
  const ids = (ws.last().data as Array<{ id: string }>).map(s => s.id)
  expect(ids).not.toContain(session.id)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/session-management-rpc.test.ts`

Expected: FAIL because `sessions.rename` and `sessions.delete` RPCs do not exist.

- [ ] **Step 3: Implement core/RPC types and handlers**

Add WS client message types:

```ts
export interface SessionsRenameMsg extends ClientMessage { type: 'sessions.rename'; sessionId: string; title: string }
export interface SessionsDeleteMsg extends ClientMessage { type: 'sessions.delete'; sessionId: string }
export interface SessionsCloseMsg extends ClientMessage { type: 'sessions.close'; sessionId: string }
export interface SessionsArchiveMsg extends ClientMessage { type: 'sessions.archive'; sessionId: string }
```

Add `session:changed` event and broadcast. Implement in `sessionManager`:

```ts
renameSession(sessionId: string, title: string): SessionRow
deleteSession(sessionId: string): Promise<void>
archiveSession(sessionId: string): Promise<SessionRow | undefined>
```

Wire WS cases:

```ts
case 'sessions.rename':
case 'sessions.close':
case 'sessions.archive':
case 'sessions.delete':
```

Also fix `sessions.create` to return `sessionStore.get(session.id)`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/integration/session-management-rpc.test.ts`

Expected: PASS.

---

### Task 3: Project scope and fork context fixes

**Files:**
- Modify: `src/core/sessions.ts`
- Modify: `src/gateway/ws-handler.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `tests/integration/ws-fork.test.ts`
- Test: `tests/integration/session-project-cwd.test.ts`, `tests/integration/project-scope.test.ts`, `tests/integration/ws-fork.test.ts`

- [ ] **Step 1: Add failing fork project context assertion**

Modify `tests/integration/ws-fork.test.ts` to create a project-backed source session and assert the forked row keeps `project_id` and `acpHost.forkSession` receives `{ projectId, cwd }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/ws-fork.test.ts`

Expected: FAIL because fork currently creates a session without `projectId` and calls `acpHost.forkSession` without context.

- [ ] **Step 3: Implement project scope**

Change `sessionManager.createSession(agentId, taskId?, projectId?)` to pass explicit project context into `resolveSessionProjectContext`.

Change WS:

```ts
sessionStore.list(msg.agentId as string | undefined, msg.projectId as string | undefined)
sessionManager.createSession(agentId, taskId, projectId)
```

Change fork:

```ts
const forked = sessionStore.create({ agentId: source.agent_id, taskId: source.task_id ?? undefined, projectId: source.project_id ?? undefined })
const project = source.project_id ? projectStore.get(source.project_id) : undefined
const acpSessionId = await acpHost.forkSession(source.agent_id, sessionId, forked.id, { projectId: source.project_id ?? undefined, cwd: project?.work_dir })
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/integration/ws-fork.test.ts tests/integration/session-project-cwd.test.ts tests/integration/project-scope.test.ts
```

Expected: PASS.

---

### Task 4: Frontend project-scoped Session list and actions

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Modify: `ui/src/stores/agent.store.ts`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [ ] **Step 1: Update store APIs**

Change signatures:

```ts
fetchSessions: (agentId?: string, projectId?: string) => Promise<void>
createSession: (agentId: string, taskId?: string, projectId?: string) => Promise<SessionData>
renameSession: (sessionId: string, title: string) => Promise<void>
deleteSession: (sessionId: string) => Promise<void>
closeSession: (sessionId: string) => Promise<void>
archiveSession: (sessionId: string) => Promise<void>
```

Extend `SessionData` with `title`, `project_id`, `updated_at`, `last_message_at`, `archived_at`, `deleted_at`.

- [ ] **Step 2: Wire Workspace behavior**

In `Workspace.tsx`:

- Refetch `agents`, `sessions`, and `tasks` when `currentProjectId` changes.
- Pass `currentProjectId` to `createSession`.
- Show `session.title || 会话 xxxxxx`.
- Add a small `⋯` action button per session with rename/delete/close options.
- Confirm delete with `window.confirm('确定删除这个会话吗？历史记录会从列表隐藏。')`.

- [ ] **Step 3: Run UI build**

Run: `npm run build -w ui`

Expected: TypeScript/Vite build succeeds.

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `README.md`

- [ ] **Step 1: Update docs**

Document:

- `sessions.rename`
- `sessions.close`
- `sessions.archive`
- `sessions.delete`
- Session metadata fields
- Project-scoped session list/create
- Soft delete behavior

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: Report actual result. If lint/build fails due pre-existing or new issues, fix new issues and document remaining pre-existing failures.

---

## Self-Review

- Spec coverage: covers create response consistency, project filter, rename, delete, close/archive, fork context, UI actions, docs.
- Placeholder scan: no TBD/TODO/fill-in steps; each implementation step names files and APIs.
- Type consistency: backend uses snake_case DB rows and frontend `SessionData` mirrors rows; RPC names use `sessions.*` consistently.
