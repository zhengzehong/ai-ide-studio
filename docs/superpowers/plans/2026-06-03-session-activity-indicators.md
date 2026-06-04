# Session Activity Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left session list show reliable per-session activity: green pulsing dot while running, yellow unread dot after background completion, and normal green after the user opens the session.

**Architecture:** Use an explicit global `session:activity` event instead of deriving UI state from `session.status` or lifecycle text. Backend emits activity transitions at prompt start/end for every session; frontend keeps ephemeral UI state for running/unread and renders session dots from a small helper with clear priority rules.

**Tech Stack:** Hono/ws backend event bus (`mitt`), ACP session manager, WebSocket RPC/events, React 19 + Zustand, Vitest.

---

## Design Decisions

### State meaning

Do not overload `sessions.status`:

- `sessions.status` stays lifecycle state: `active`, `closed`, etc.
- New `session:activity` represents turn execution state: `running`, `idle`.
- Frontend `unread` is local browser state, not persisted to SQLite in this version.

### Dot priority

For each session row:

1. `runningSessionIds[session.id]` -> green pulsing dot.
2. `unreadSessionIds[session.id]` -> yellow static dot.
3. `session.status === 'active'` -> green static dot.
4. otherwise -> gray static dot.

When a running background session finishes, it becomes unread yellow. When the user selects it, unread is cleared and it returns to normal green.

### Event semantics

New server event:

```ts
type SessionActivityState = 'running' | 'idle'

{
  type: 'session:activity'
  sessionId: string
  agentId: string
  state: SessionActivityState
  reason: 'prompt-started' | 'prompt-done' | 'prompt-error' | 'prompt-cancelled' | 'runtime-exit' | 'startup-recovery'
  timestamp: string
}
```

Rules:

- Emit `running` only when the prompt actually enters `sendPromptNow`, including queued/team prompts.
- Emit `idle` in `finally` after `activePrompts.delete(sessionId)`.
- Also emit/keep `idle` on `session:done` safety paths if a prompt ends outside normal flow.
- Broadcast `session:activity` to all clients, not just subscribers, so background sessions update the sidebar.

### Initial load behavior

On `sessions.list`, frontend may infer `running` from `stage` only as a recovery fallback. The canonical live source remains `session:activity`.

- If a session has a known running `stage`, mark it running on fetch.
- If it has interrupted/empty stage, do not mark running.
- Do not mark unread from historical DB rows; unread starts with live background completions only.

---

## File Map

### Backend

- Modify: `src/types/ws-protocol.ts`
  - Add `SessionActivityState`, `SessionActivityReason`, `SessionActivityData`.
  - Add `{ type: 'session:activity' } & SessionActivityData` to `ServerMessage`.

- Modify: `src/core/events.ts`
  - Add `'session:activity': SessionActivityData` to `AppEvents`.

- Modify: `src/gateway/ws-handler.ts`
  - Listen for `events.on('session:activity')`.
  - Broadcast to all clients.

- Modify: `src/core/sessions.ts`
  - Add helper `emitSessionActivity(sessionId, agentId, state, reason)`.
  - Emit running/idle around `activePrompts` in `sendPromptNow`.
  - Make sure errors and cancellation still end in idle.

### Frontend

- Modify: `ui/src/stores/session.store.ts`
  - Add `runningSessionIds: Record<string, true>`.
  - Add `unreadSessionIds: Record<string, true>`.
  - Add listener for `session:activity`.
  - Clear unread in `selectSession(id)`.
  - Initialize running map from `sessions.list` fallback stage.

- Create: `ui/src/utils/session-indicators.ts`
  - Pure helpers:
    - `isRunningStage(stage?: string | null): boolean`
    - `sessionIndicator(session, runningMap, unreadMap): { color, pulse, title }`
    - `markSessionActivity(...)`
  - Keeps `Workspace.tsx` from growing more.

- Modify: `ui/src/pages/Workspace.tsx`
  - Read `runningSessionIds` and `unreadSessionIds` from store.
  - Use helper to render the session dot.

- Modify: `ui/src/index.css`
  - Add one keyframe for green pulse.

### Tests

- Create or modify: `tests/unit/session-activity-indicators.test.ts`
  - Test pure helper priority and unread clearing state transitions.

- Modify: `tests/unit/session-store-done-refresh.test.ts`
  - Test frontend receives `session:activity` for background session:
    - running -> running map set.
    - idle while not selected -> unread set.
    - select session -> unread cleared.

- Create or modify: `tests/integration/session-activity-events.test.ts`
  - Test backend emits running then idle when `sessionManager.sendPrompt()` completes.
  - Test backend emits idle when ACP prompt throws.

- Optional focused UI test if current setup supports it; otherwise pure helper + store tests are enough.

---

## Task 1: Backend Event Contract

**Files:**
- Modify: `src/types/ws-protocol.ts`
- Modify: `src/core/events.ts`
- Modify: `src/gateway/ws-handler.ts`

- [x] Add exported types:

```ts
export type SessionActivityState = 'running' | 'idle'
export type SessionActivityReason =
  | 'prompt-started'
  | 'prompt-done'
  | 'prompt-error'
  | 'prompt-cancelled'
  | 'runtime-exit'
  | 'startup-recovery'

export interface SessionActivityData {
  sessionId: string
  agentId: string
  state: SessionActivityState
  reason: SessionActivityReason
  timestamp: string
}
```

- [x] Add to `ServerMessage`:

```ts
| ({ type: 'session:activity' } & SessionActivityData)
```

- [x] Add to `AppEvents`:

```ts
'session:activity': SessionActivityData
```

- [x] Add gateway broadcast:

```ts
events.on('session:activity', (ev) => {
  broadcastToAll({ type: 'session:activity', ...ev })
})
```

- [x] Verify TypeScript compile passes after all files are aligned (`npm run build`).

---

## Task 2: Backend Prompt Lifecycle Emission

**Files:**
- Modify: `src/core/sessions.ts`
- Test: `tests/integration/session-activity-events.test.ts`

- [x] Write failing test: successful prompt emits running then idle.

Test structure:

```ts
const seen: SessionActivityData[] = []
const off = (ev: SessionActivityData) => seen.push(ev)
events.on('session:activity', off)

await sessionManager.sendPrompt(session.id, 'hello')

expect(seen.map((item) => item.state)).toEqual(['running', 'idle'])
expect(seen[0]).toMatchObject({ sessionId: session.id, agentId: agent.id, reason: 'prompt-started' })
expect(seen[1]).toMatchObject({ sessionId: session.id, agentId: agent.id, reason: 'prompt-done' })
```

- [x] Write failing test: prompt error emits running then idle with `prompt-error`.

```ts
acpHost.prompt = async () => { throw new Error('adapter failed') }
await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('adapter failed')
expect(seen.map((item) => `${item.state}:${item.reason}`)).toEqual([
  'running:prompt-started',
  'idle:prompt-error',
])
```

- [x] Implement helper in `src/core/sessions.ts`:

```ts
function emitSessionActivity(
  sessionId: string,
  agentId: string,
  state: 'running' | 'idle',
  reason: SessionActivityReason,
): void {
  events.emit('session:activity', {
    sessionId,
    agentId,
    state,
    reason,
    timestamp: new Date().toISOString(),
  })
}
```

- [x] In `sendPromptNow`, after `activePrompts.add(sessionId)`, emit running.

- [x] In `catch`, store a local `activityEndReason = 'prompt-error'`.

- [x] In `finally`, after `activePrompts.delete(sessionId)`, emit idle with:
  - `prompt-error` if catch happened.
  - `prompt-cancelled` if cancellation can be detected cheaply from existing stop reason path.
  - otherwise `prompt-done`.

Keep this simple: do not refactor ACP prompt/cancel architecture in this task.

- [x] Run:

```bash
npm test -- tests/integration/session-activity-events.test.ts
```

Expected: new tests pass.

---

## Task 3: Frontend Activity Store

**Files:**
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/unit/session-store-done-refresh.test.ts`

- [x] Extend `SessionStore`:

```ts
runningSessionIds: Record<string, true>
unreadSessionIds: Record<string, true>
```

- [x] Add defaults in initial state and reset paths:

```ts
runningSessionIds: {},
unreadSessionIds: {},
```

Do not clear these maps when switching sessions. Clear deleted session keys when session is deleted.

- [x] Add `session:activity` listener:

```ts
offs.push(wsClient.on('session:activity', (msg) => {
  const sessionId = String(msg.sessionId || '')
  const state = msg.state === 'running' ? 'running' : 'idle'
  if (!sessionId) return
  set((st) => {
    const running = { ...st.runningSessionIds }
    const unread = { ...st.unreadSessionIds }
    if (state === 'running') {
      running[sessionId] = true
      delete unread[sessionId]
    } else {
      delete running[sessionId]
      if (st.currentSessionId !== sessionId) unread[sessionId] = true
    }
    return { runningSessionIds: running, unreadSessionIds: unread }
  })
}))
```

- [x] In `selectSession(id)`, when selecting non-null id:

```ts
set((state) => {
  const unread = { ...state.unreadSessionIds }
  delete unread[id]
  return { unreadSessionIds: unread }
})
```

Integrate with the existing `set(...)` in `selectSession` to avoid double-render if convenient.

- [x] In `session:changed` delete branch, remove the session id from both maps.

- [x] Add tests:

```ts
emit('session:activity', { sessionId: 'sess-bg', agentId: 'agent-1', state: 'running', reason: 'prompt-started', timestamp: '...' })
expect(useSessionStore.getState().runningSessionIds['sess-bg']).toBe(true)

emit('session:activity', { sessionId: 'sess-bg', agentId: 'agent-1', state: 'idle', reason: 'prompt-done', timestamp: '...' })
expect(useSessionStore.getState().runningSessionIds['sess-bg']).toBeUndefined()
expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBe(true)

useSessionStore.getState().selectSession('sess-bg')
expect(useSessionStore.getState().unreadSessionIds['sess-bg']).toBeUndefined()
```

- [x] Run:

```bash
npm test -- tests/unit/session-store-done-refresh.test.ts
```

---

## Task 4: Session Indicator Helper and UI

**Files:**
- Create: `ui/src/utils/session-indicators.ts`
- Modify: `ui/src/pages/Workspace.tsx`
- Modify: `ui/src/index.css`
- Test: `tests/unit/session-activity-indicators.test.ts`

- [x] Create helper with pure logic:

```ts
interface IndicatorSession {
  id: string
  status: string
  stage?: string | null
}

export function sessionIndicator(
  session: IndicatorSession,
  runningSessionIds: Record<string, true>,
  unreadSessionIds: Record<string, true>,
): { color: string; pulse: boolean; title: string } {
  if (runningSessionIds[session.id]) return { color: 'var(--green)', pulse: true, title: '正在执行' }
  if (unreadSessionIds[session.id]) return { color: 'var(--yellow)', pulse: false, title: '有新回复' }
  if (session.status === 'active') return { color: 'var(--green)', pulse: false, title: '可用' }
  return { color: 'var(--text-3)', pulse: false, title: '已关闭' }
}
```

- [x] Add unit test for priority:

```ts
expect(sessionIndicator(activeSession, { [id]: true }, { [id]: true })).toMatchObject({ pulse: true, title: '正在执行' })
expect(sessionIndicator(activeSession, {}, { [id]: true })).toMatchObject({ color: 'var(--yellow)', title: '有新回复' })
expect(sessionIndicator(activeSession, {}, {})).toMatchObject({ color: 'var(--green)', title: '可用' })
```

- [x] In `Workspace.tsx`, read maps:

```ts
const runningSessionIds = useSessionStore((s) => s.runningSessionIds)
const unreadSessionIds = useSessionStore((s) => s.unreadSessionIds)
```

- [x] Replace the existing session dot style:

```tsx
const indicator = sessionIndicator(s, runningSessionIds, unreadSessionIds)

<span
  style={{
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: indicator.color,
    flexShrink: 0,
    animation: indicator.pulse ? 'session-running-pulse 1s ease-in-out infinite' : undefined,
    boxShadow: indicator.pulse ? '0 0 0 4px rgba(5, 150, 105, 0.12)' : undefined,
  }}
  title={indicator.title}
/>
```

- [x] Add CSS:

```css
@keyframes session-running-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(1.35); }
}
```

- [x] Run:

```bash
npm test -- tests/unit/session-activity-indicators.test.ts
npm run build
```

---

## Task 5: Initial Load Recovery Fallback

**Files:**
- Modify: `ui/src/utils/session-indicators.ts`
- Modify: `ui/src/stores/session.store.ts`
- Test: `tests/unit/session-activity-indicators.test.ts`

- [x] Add helper:

```ts
const RUNNING_STAGE_TEXTS = new Set([
  '正在准备 Agent...',
  '正在启动 Agent...',
  'Agent 已就绪',
  '正在连接会话...',
  '正在恢复会话...',
  '会话已连接',
  '正在思考...',
])

export function isRunningStage(stage?: string | null): boolean {
  return !!stage && RUNNING_STAGE_TEXTS.has(stage)
}
```

- [x] In `fetchSessions`, after filtering sessions by project, build `runningSessionIds` from rows with running stage, but preserve already-running ids from live events:

```ts
const inferredRunning = Object.fromEntries(
  sessions.filter((session) => isRunningStage(session.stage)).map((session) => [session.id, true]),
) as Record<string, true>
set((state) => ({
  sessions,
  runningSessionIds: { ...inferredRunning, ...state.runningSessionIds },
}))
```

- [x] Do not infer unread from `last_message_at`.

- [x] Add tests for `isRunningStage`.

---

## Task 6: Documentation and Verification

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Optional modify: `docs/architecture/overview.md` if it already documents realtime session events.

- [x] Document `session:activity`:

```md
### session:activity

Global event broadcast to all connected clients when a session turn starts or ends. It is used for sidebar activity indicators and must not be used as the source of chat content.
```

- [x] Run targeted tests:

```bash
npm test -- tests/integration/session-activity-events.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/session-activity-indicators.test.ts
```

- [x] Run full verification:

```bash
npm test
npm run build
npm run lint
git diff --check
```

- [x] Manual dev browser smoke check:

1. Started Vite UI smoke check on `http://localhost:5173/workspace`; page loaded and no console errors.
2. Started built server on `http://127.0.0.1:18910/workspace` with isolated data.
3. Created a project, mock agent, and multiple sessions.
4. Verified `session:activity` broadcasts from backend on prompt start.
5. Verified a background session becomes yellow `有新回复` after idle/error.
6. Verified clicking that session clears unread and returns it to green `可用`.
7. Note: production mock agent execution currently exits because `dist/acp/mock-agent.ts` is not present; this appears unrelated to this indicator change, so the manual check used the error-path idle transition plus automated successful-prompt tests.

---

## Non-goals

- Do not persist unread state to SQLite until the platform has user identity.
- Do not change `sessions.status` semantics.
- Do not refactor close/cancel session behavior in this task.
- Do not subscribe the frontend to every session event; the global activity event is intentionally small.
- Do not change chat message rendering or event timeline logic.

## Self-review

- Backend has one explicit global event and does not rely on lifecycle text for live behavior.
- Frontend stores only UI state for running/unread and keeps DB lifecycle state separate.
- UI change is limited to the existing session dot and one keyframe.
- Tests cover backend event emission, frontend state transitions, and indicator priority.
- Scope excludes the previously found `sessions.close` running-session bug.
