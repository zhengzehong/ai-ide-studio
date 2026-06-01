# Team Event Wake and Task Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Team collaboration event-driven: Leaders do not wait after dispatching, member replies wake the Leader, and members can only update their own assigned tasks.

**Architecture:** Keep Team orchestration in focused backend modules. `src/core/teams.ts` remains the Team service facade; new prompt and wake helpers keep collaboration text and wake scheduling out of handlers. Tool handlers pass actor context into service-level permission checks so MCP, UI, and future APIs share the same rules.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, mitt event bus, existing ACP session manager and MCP tool handlers.

---

## File map

- Modify `tests/unit/team-tool-handlers.test.ts`: add regression tests for member prompt contract, Leader wake prompts, and member task ownership.
- Create `src/core/team-prompts.ts`: builds member assignment prompts and Leader wake prompts.
- Create `src/core/team-wake-coordinator.ts`: schedules system wake prompts to the Team Leader after member mailbox/task terminal events.
- Modify `src/core/teams.ts`: use prompt helper, pass actor context to task update, call wake coordinator on mailbox/task events.
- Modify `src/tools/handlers/team/team-tools.ts`: pass `context.teamMemberId` into `teamService.updateTask()`.
- Modify `docs/architecture/team-mcp-tools.md`: document event-driven Team flow and member task scope.

---

### Task 1: Failing tests for prompts, wake, and task ownership

**Files:**
- Modify: `tests/unit/team-tool-handlers.test.ts`

- [ ] **Step 1: Add tests for the new behavior**

Add tests in `describe('team MCP tool handlers', () => { ... })` after the existing dispatch test:

```ts
test('team.member.message prompt tells members to report and not wait for leader', async () => {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
  const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
  const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)

  await executeJson('team.member.message', {
    teamId: asRecord(team.team).id,
    memberId: asRecord(team.member).id,
    content: 'start work',
    taskId: 'task-demo',
  })

  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('禁止等待 Leader'))
  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('team.mailbox.send'))
  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('team.task.update'))
})

test('team.mailbox.send from member wakes the leader with a system prompt', async () => {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
  const spawned = await executeJson('team.member.spawn', {
    teamId: asRecord(team.team).id,
    agentId: worker.id,
    name: 'Worker',
  })
  const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)

  await executeJson('team.mailbox.send', {
    type: 'report',
    content: 'finished the work',
  }, {
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    teamMemberId: asRecord(spawned.member).id as string,
    agentId: worker.id,
  })

  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('系统通知'))
  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('finished the work'))
  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('不要使用 sleep'))
})

test('team.task.update by member wakes the leader when task reaches completed', async () => {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
  const spawned = await executeJson('team.member.spawn', {
    teamId: asRecord(team.team).id,
    agentId: worker.id,
    name: 'Worker',
  })
  const task = taskStore.create({
    title: 'Complete me',
    source: 'agent',
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    assigneeMemberId: asRecord(spawned.member).id as string,
    assignAgentId: worker.id,
  })
  const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)

  await executeJson('team.task.update', {
    taskId: task.id,
    status: 'completed',
    stage: 'done',
  }, {
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    teamMemberId: asRecord(spawned.member).id as string,
    agentId: worker.id,
  })

  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining(task.id))
  expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('completed'))
})

test('team.task.update rejects member updating another member task', async () => {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const workerA = agentStore.create({ name: 'Worker A', type: 'dev', runtime: 'mock', projectId: project.id })
  const workerB = agentStore.create({ name: 'Worker B', type: 'dev', runtime: 'mock', projectId: project.id })
  const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
  const memberA = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, agentId: workerA.id, name: 'A' })
  const memberB = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, agentId: workerB.id, name: 'B' })
  const task = taskStore.create({
    title: 'Owned by A',
    source: 'agent',
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    assigneeMemberId: asRecord(memberA.member).id as string,
    assignAgentId: workerA.id,
  })
  const handler = getRequiredHandler('team.task.update')

  await expect(handler.execute({ taskId: task.id, status: 'completed' }, {
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    teamMemberId: asRecord(memberB.member).id as string,
    agentId: workerB.id,
  })).rejects.toThrow('只能更新分配给自己的 Team 任务')
})

test('team.task.update rejects member reassigning their task', async () => {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const workerA = agentStore.create({ name: 'Worker A', type: 'dev', runtime: 'mock', projectId: project.id })
  const workerB = agentStore.create({ name: 'Worker B', type: 'dev', runtime: 'mock', projectId: project.id })
  const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
  const memberA = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, agentId: workerA.id, name: 'A' })
  const memberB = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, agentId: workerB.id, name: 'B' })
  const task = taskStore.create({
    title: 'Owned by A',
    source: 'agent',
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    assigneeMemberId: asRecord(memberA.member).id as string,
    assignAgentId: workerA.id,
  })
  const handler = getRequiredHandler('team.task.update')

  await expect(handler.execute({ taskId: task.id, assigneeMemberId: asRecord(memberB.member).id }, {
    projectId: project.id,
    teamId: asRecord(team.team).id as string,
    teamMemberId: asRecord(memberA.member).id as string,
    agentId: workerA.id,
  })).rejects.toThrow('Team 成员不能重新分配任务')
})
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run:

```bash
npm test -- tests/unit/team-tool-handlers.test.ts
```

Expected: FAIL because prompt strings are missing, Leader wake does not happen, and ownership checks are not implemented.

---

### Task 2: Prompt builders and member assignment prompt

**Files:**
- Create: `src/core/team-prompts.ts`
- Modify: `src/core/teams.ts`

- [ ] **Step 1: Create prompt helper**

Create `src/core/team-prompts.ts`:

```ts
import type { TaskRow } from '../store/tasks.js'
import type { TeamMailboxRow, TeamMemberRow, TeamRow } from '../store/teams.js'

export function buildTeamMemberPrompt(input: {
  team: TeamRow
  member: TeamMemberRow
  content: string
  taskId?: string
}): string {
  return [
    '你正在作为 AI IDE Studio Team 成员执行一次异步协作任务。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
    input.taskId ? `Task: ${input.taskId}` : undefined,
    '',
    '协作规则：',
    '- 只处理本次派发给你的工作，不要自行扩展团队范围。',
    '- 完成、遇到阻塞或需要提问时，必须使用 team.mailbox.send 汇报。',
    '- 如果本次包含 Task ID，只能使用 team.task.update 更新分配给自己的任务状态或阶段。',
    '- 不要填写或伪造 fromMemberId，系统会使用当前成员身份。',
    '- 禁止等待 Leader、禁止 sleep、禁止轮询；提交汇报后结束本轮。',
    '',
    'Leader 派发内容：',
    input.content,
  ].filter((item): item is string => typeof item === 'string').join('\n')
}

export function buildLeaderWakePrompt(input: {
  team: TeamRow
  member: TeamMemberRow
  message?: TeamMailboxRow
  task?: TaskRow
  reason: 'mailbox' | 'task'
}): string {
  const lines = [
    '系统通知：Team 成员有新的异步进展。',
    `Team: ${input.team.name} (${input.team.id})`,
    `Member: ${input.member.name} (${input.member.id})`,
  ]

  if (input.message) {
    lines.push(`Mailbox: ${input.message.type} (${input.message.id})`)
    if (input.message.task_id) lines.push(`Task: ${input.message.task_id}`)
    lines.push(`Content: ${input.message.content}`)
  }

  if (input.task) {
    lines.push(`Task: ${input.task.title} (${input.task.id})`)
    lines.push(`Status: ${input.task.status}`)
    if (input.task.stage) lines.push(`Stage: ${input.task.stage}`)
  }

  lines.push(
    '',
    '请先使用 team.mailbox.list / team.task.list 查看最新状态，然后总结结果或继续派发下一步。',
    '不要使用 sleep、等待命令或轮询；如果还需要其他成员结果，请结束本轮，系统会在新进展到达时再次唤醒你。',
  )

  return lines.join('\n')
}
```

- [ ] **Step 2: Use prompt helper in Team service**

In `src/core/teams.ts`, import `buildTeamMemberPrompt` and replace `buildMemberPrompt(...)` usage with:

```ts
const prompt = buildTeamMemberPrompt({ team, member, content: input.content, taskId: input.taskId })
```

Remove the old local `buildMemberPrompt()` function.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npm test -- tests/unit/team-tool-handlers.test.ts
```

Expected: prompt contract test passes; wake and ownership tests still fail.

---

### Task 3: Team wake coordinator

**Files:**
- Create: `src/core/team-wake-coordinator.ts`
- Modify: `src/core/teams.ts`

- [ ] **Step 1: Implement wake coordinator**

Create `src/core/team-wake-coordinator.ts`:

```ts
import { taskStore, type TaskRow } from '../store/tasks.js'
import {
  teamMailboxStore,
  teamMemberStore,
  teamStore,
  type TeamMailboxRow,
  type TeamMemberRow,
  type TeamRow,
} from '../store/teams.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { buildLeaderWakePrompt } from './team-prompts.js'

const log = createChildLogger('team-wake')
const WAKE_MAILBOX_TYPES = new Set(['report', 'result', 'question', 'blocked'])
const WAKE_TASK_STATUSES = new Set(['completed', 'blocked'])
const pendingByLeaderSession = new Map<string, string>()
const activeLeaderSessions = new Set<string>()

events.on('session:done', (ev) => {
  activeLeaderSessions.delete(ev.sessionId)
  const pending = pendingByLeaderSession.get(ev.sessionId)
  if (!pending) return
  pendingByLeaderSession.delete(ev.sessionId)
  sendWake(ev.sessionId, pending)
})

export const teamWakeCoordinator = {
  notifyMailbox(message: TeamMailboxRow): void {
    if (!message.from_member_id || !WAKE_MAILBOX_TYPES.has(message.type)) return
    const team = teamStore.get(message.team_id)
    const member = teamMemberStore.get(message.from_member_id)
    if (!team || !member || member.role === 'leader') return
    const task = message.task_id ? taskStore.get(message.task_id) : undefined
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, message, task, reason: 'mailbox' }))
  },

  notifyTaskUpdated(task: TaskRow, actor?: { teamMemberId?: string }): void {
    if (!task.team_id || !actor?.teamMemberId || !WAKE_TASK_STATUSES.has(task.status)) return
    const team = teamStore.get(task.team_id)
    const member = teamMemberStore.get(actor.teamMemberId)
    if (!team || !member || member.role === 'leader') return
    scheduleLeaderWake(team, member, buildLeaderWakePrompt({ team, member, task, reason: 'task' }))
  },
}

function scheduleLeaderWake(team: TeamRow, member: TeamMemberRow, prompt: string): void {
  const leader = teamMemberStore.list(team.id).find(item => item.role === 'leader')
  if (!leader) {
    log.warn({ teamId: team.id, memberId: member.id }, 'Team Leader missing; wake skipped')
    return
  }

  if (activeLeaderSessions.has(leader.session_id)) {
    pendingByLeaderSession.set(leader.session_id, prompt)
    log.debug({ teamId: team.id, leaderSessionId: leader.session_id }, 'Team Leader wake queued')
    return
  }

  sendWake(leader.session_id, prompt)
}

function sendWake(leaderSessionId: string, prompt: string): void {
  activeLeaderSessions.add(leaderSessionId)
  void sessionManager.sendPrompt(leaderSessionId, prompt).catch((err: unknown) => {
    activeLeaderSessions.delete(leaderSessionId)
    log.error({ err, leaderSessionId }, 'Team Leader wake failed')
  })
}
```

- [ ] **Step 2: Call coordinator from Team service**

In `src/core/teams.ts`, import `teamWakeCoordinator`.

After `teamMailboxStore.create(...)` in `sendMailbox()`, assign to `message`, call `teamWakeCoordinator.notifyMailbox(message)`, and return `message`.

After `taskStore.update(...)` succeeds in `updateTask()`, call:

```ts
teamWakeCoordinator.notifyTaskUpdated(updated, input.actor)
```

This requires adding an optional actor field to `UpdateTeamTaskInput` in Task 4.

- [ ] **Step 3: Run targeted tests**

Run:

```bash
npm test -- tests/unit/team-tool-handlers.test.ts
```

Expected: wake tests pass once Task 4 compiles; ownership tests still fail until Task 4.

---

### Task 4: Service-level task ownership checks

**Files:**
- Modify: `src/core/teams.ts`
- Modify: `src/tools/handlers/team/team-tools.ts`

- [ ] **Step 1: Extend update input with actor context**

In `src/core/teams.ts`, change `UpdateTeamTaskInput` to include:

```ts
actor?: { teamMemberId?: string }
```

- [ ] **Step 2: Enforce member ownership before updating**

In `teamService.updateTask()`, after `const task = ensureTaskInTeam(...)`, add:

```ts
const actor = input.actor?.teamMemberId ? requireMember(input.actor.teamMemberId) : undefined
if (actor) {
  ensureMemberInTeam(actor, team)
  if (actor.role !== 'leader') {
    if (task.assignee_member_id !== actor.id) throw new Error('只能更新分配给自己的 Team 任务')
    if (input.assigneeMemberId !== undefined && input.assigneeMemberId !== task.assignee_member_id) {
      throw new Error('Team 成员不能重新分配任务')
    }
  }
}
```

Then keep existing assignee validation and update logic.

- [ ] **Step 3: Pass actor context from MCP handler**

In `src/tools/handlers/team/team-tools.ts`, update the `teamService.updateTask()` call:

```ts
const task = teamService.updateTask({
  teamId,
  taskId: requireString(input, 'taskId'),
  status: optionalString(input, 'status'),
  stage: optionalString(input, 'stage'),
  assigneeMemberId: optionalNullableString(input, 'assigneeMemberId'),
  actor: { teamMemberId: context.teamMemberId },
})
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm test -- tests/unit/team-tool-handlers.test.ts
```

Expected: all team handler tests pass.

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `docs/architecture/team-mcp-tools.md`

- [ ] **Step 1: Update Team MCP architecture doc**

Add a concise section covering:

```md
## Event-driven Team collaboration

Team dispatch is asynchronous. A Leader uses `team.member.message` to assign work, then ends the turn instead of waiting, sleeping, or polling. Members report progress through `team.mailbox.send` and update their own assigned task with `team.task.update`. Report/result/question/blocked mailbox messages and completed/blocked task updates wake the Leader session with a system prompt.

## Member task scope

Tool visibility controls which Team tools an Agent can see. Runtime scope additionally restricts member actions: a non-leader Team member can only update a task whose `assignee_member_id` matches the current `teamMemberId`, and cannot change `assigneeMemberId`. Leaders can update or reassign any task in their Team.
```

- [ ] **Step 2: Run required verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected:
- `npm test`: all tests pass.
- `npm run build`: server and UI build pass; Vite chunk warning is acceptable if unchanged.
- `npm run lint`: no errors.
- `git diff --check`: no whitespace errors.
