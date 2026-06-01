# Session Team Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team collaboration usable inside the existing conversation page: Leader and members remain normal Agent sessions, and the right-side context panel shows the current Team with member session switching, tasks, and mailbox.

**Architecture:** Add a thin backend read RPC that resolves Team context from the current `sessionId`, then add a focused frontend Team store and Team context component. Keep Team as conversation context, not a separate route/page, and reuse existing session switching for member chats.

**Tech Stack:** TypeScript, Hono/ws RPC, better-sqlite3 stores, React 19, Zustand, Vitest.

---

## File Structure

- Modify `src/core/teams.ts`: expose `currentBySession(sessionId)` by looking up `team_members.session_id` and returning the same detail shape plus `currentMember`.
- Create `src/gateway/rpc/teams.ts`: add `teams.current` RPC.
- Modify `src/gateway/rpc/registry.ts`: register Team RPC handlers.
- Modify `src/types/ws-protocol.ts`: add Team RPC message/server payload types.
- Create `tests/unit/team-current-rpc.test.ts`: verify `teams.current` returns null for normal sessions and Team detail for leader/member sessions.
- Create `ui/src/stores/team.store.ts`: Zustand store for current Team context keyed by `sessionId`.
- Create `ui/src/components/team/TeamContextPanel.tsx`: right-side in-conversation Team context UI.
- Modify `ui/src/stores/task.store.ts`: include `team_id` and `assignee_member_id` in `TaskData`.
- Modify `ui/src/pages/Workspace.tsx`: fetch current Team context when session changes, render Team context instead of normal task list when available, and switch sessions when clicking a member.
- Modify `ui/src/pages/workspace/helpers.ts`: add Team tool call summary helper or extend existing `toolSummary`.
- Update architecture docs if new WS method is added: `docs/architecture/ws-protocol.md` and `docs/architecture/overview.md`.

---

### Task 1: Backend Team current context RPC

**Files:**
- Modify: `src/core/teams.ts`
- Create: `src/gateway/rpc/teams.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/types/ws-protocol.ts`
- Test: `tests/unit/team-current-rpc.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/team-current-rpc.test.ts` with tests that initialize a temp DB, create project/agents/sessions/team, and assert:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'
import { teamRpcHandlers } from '../../src/gateway/rpc/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-current-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('teams.current RPC', () => {
  test('returns null when the session is not a Team member session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const data = await callTeamsCurrent(session.id)

    expect(data).toEqual({ team: null, currentMember: null, members: [], tasks: [], mailbox: [] })
  })

  test('returns Team detail and current leader member for the leader session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })

    const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, leaderSessionId: leaderSession.id, name: 'Alpha' })
    const data = await callTeamsCurrent(leaderSession.id)

    expect(data.team).toMatchObject({ id: created.team.id, name: 'Alpha', project_id: project.id })
    expect(data.currentMember).toMatchObject({ id: created.member.id, role: 'leader', session_id: leaderSession.id })
    expect(data.members).toHaveLength(1)
  })

  test('returns same Team detail and current member for a spawned member session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
    const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
    const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, leaderSessionId: leaderSession.id, name: 'Alpha' })
    const spawned = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, role: 'worker' })

    const data = await callTeamsCurrent(spawned.session.id)

    expect(data.team).toMatchObject({ id: created.team.id })
    expect(data.currentMember).toMatchObject({ id: spawned.member.id, role: 'worker', session_id: spawned.session.id })
    expect(data.members.map(member => member.id)).toEqual([created.member.id, spawned.member.id])
  })
})

async function callTeamsCurrent(sessionId: string): Promise<Record<string, any>> {
  let result: unknown
  await teamRpcHandlers['teams.current']({ type: 'teams.current', sessionId }, {
    state: { subscriptions: new Set() },
    sendResult: data => { result = data },
    sendError: message => { throw new Error(message) },
    sendOutOfBandError: message => { throw new Error(message) },
  })
  return result as Record<string, any>
}
```

- [ ] **Step 2: Run red test**

Run: `npm test tests/unit/team-current-rpc.test.ts`
Expected: fail because `src/gateway/rpc/teams.ts` does not exist or handler is missing.

- [ ] **Step 3: Implement backend**

Add `currentBySession(sessionId)` to `teamService`, create `teamRpcHandlers` with `teams.current`, register it, and add the protocol type.

- [ ] **Step 4: Run green test**

Run: `npm test tests/unit/team-current-rpc.test.ts`
Expected: pass.

---

### Task 2: Frontend Team store and in-conversation panel

**Files:**
- Create: `ui/src/stores/team.store.ts`
- Create: `ui/src/components/team/TeamContextPanel.tsx`
- Modify: `ui/src/stores/task.store.ts`
- Modify: `ui/src/pages/Workspace.tsx`

- [ ] **Step 1: Add focused store and component**

Create a Team store that calls `teams.current` and stores `{ team, currentMember, members, tasks, mailbox }`. Create a right-side panel that renders Team name/status, members, tasks, and mailbox.

- [ ] **Step 2: Integrate Workspace**

When `currentSessionId` changes, call `fetchCurrentTeam(currentSessionId)`. If `team` exists, render `TeamContextPanel`; otherwise render the existing `TaskPanel`. Member clicks call existing `handleSelectSession(member.agent_id, member.session_id)`.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: pass.

---

### Task 3: Team tool summaries in existing chat

**Files:**
- Modify: `ui/src/pages/workspace/helpers.ts`

- [ ] **Step 1: Extend `toolSummary` for `team.*`**

For known names return concise Chinese summaries from `rawInput` / `rawOutput`, including create Team, spawn member, dispatch member message, mailbox send, task create, task update, and Team get.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: pass.

---

### Task 4: Docs and verification

**Files:**
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/overview.md`

- [ ] **Step 1: Document `teams.current`**

Add the WS RPC and describe that Team UI is a conversation context, not a standalone page.

- [ ] **Step 2: Full verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: tests/build/lint pass and diff check has no errors.
