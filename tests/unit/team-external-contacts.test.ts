import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { createTeamConversation } from '../../src/core/team-conversations.js'
import { agentSessionCommunicationService } from '../../src/core/agent-session-communication.js'
import { sessionManager } from '../../src/core/sessions.js'
import { assertSessionAccess } from '../../src/core/team-access.js'
import { listPublicTeamConversations } from '../../src/core/team-contacts.js'
import { executeWithTeamBoundary } from '../../src/tools/team-boundary-guard.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { copyTeamAgent } from '../../src/core/team-member-identity.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { dispatchStep } from '../../src/core/step-dispatch.js'
import { agentSessionMessageStore, agentSessionWatchStore } from '../../src/store/agent-session-communication.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { executeRuntimeTool, listRuntimeTools } from '../../src/tools/runtime/tool-runtime.js'

let temp: string
beforeEach(() => {
  temp = mkdtempSync(resolve(tmpdir(), 'team-contacts-'))
  initDatabase(resolve(temp, 'test.sqlite'))
  vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => new Promise(() => {}))
})
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); rmSync(temp, { recursive: true, force: true }) })

function setup(): { context: { agentId: string; sessionId: string; projectId: string }; teamId: string; masterId: string; workerSession: string } {
  const project = projectStore.create({ name: 'P', workDir: temp })
  const source = agentStore.create({ name: 'Caller', type: 'coder', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: source.id, projectId: project.id })
  const team = teamStore.create({ name: 'Public team', projectId: project.id, masterPrompt: 'private' })
  const master = agentStore.create({ name: 'Private master', type: 'leader', runtime: 'mock', projectId: project.id, config: { teamInternal: true } })
  teamMemberStore.create({ teamId: team.id, projectId: project.id, agentId: master.id, name: master.name, role: 'leader', sessionId: sessionStore.create({ agentId: master.id, projectId: project.id }).id })
  const worker = agentStore.create({ name: 'Private worker', type: 'coder', runtime: 'mock', projectId: project.id, config: { teamInternal: true } })
  const workerSession = sessionStore.create({ agentId: worker.id, projectId: project.id }).id
  teamMemberStore.create({ teamId: team.id, projectId: project.id, agentId: worker.id, name: worker.name, sessionId: workerSession })
  return { context: { agentId: source.id, sessionId: session.id, projectId: project.id }, teamId: team.id, masterId: master.id, workerSession }
}

test('first contact and subsequent sends share one team line and Master replies with team name', async () => {
  const { context, teamId, masterId } = setup()
  const results = await Promise.all([1, 2].map(() => agentSessionCommunicationService.sendMessage({ context, targetTeamId: teamId, content: 'hello' })))
  const target = results[0].targetSession
  expect(results[1].targetSession.id).toBe(target.id)
  expect(teamConversationStore.list(teamId)).toHaveLength(1)
  expect(() => assertSessionAccess(context, target.id)).toThrow('内部')
  await agentSessionCommunicationService.sendMessage({ context: { ...context, agentId: masterId, sessionId: target.id }, targetSessionId: context.sessionId, content: 'done' })
  expect(sessionManager.enqueuePrompt).toHaveBeenLastCalledWith(context.sessionId, expect.stringContaining('Public team'), undefined, expect.objectContaining({ senderName: 'Public team' }))
  await agentSessionCommunicationService.sendMessage({ context, targetSessionId: target.id, content: 'follow up' })
  const unrelated = sessionStore.create({ agentId: context.agentId, projectId: context.projectId })
  expect(listPublicTeamConversations({ ...context, sessionId: unrelated.id }, teamId)).toEqual([])
  expect(listPublicTeamConversations(context, teamId)).toHaveLength(1)
})

test('Master initiated contact permits replies; closed lines never silently reopen', async () => {
  const { context, teamId, masterId } = setup()
  const line = createTeamConversation(teamId).conversation
  await agentSessionCommunicationService.sendMessage({ context: { ...context, agentId: masterId, sessionId: line.master_session_id }, targetSessionId: context.sessionId, content: 'request' })
  await agentSessionCommunicationService.sendMessage({ context, targetSessionId: line.master_session_id, content: 'reply' })
  teamConversationStore.setStatus(line.id, 'archived')
  await expect(agentSessionCommunicationService.sendMessage({ context, targetTeamId: teamId, content: 'again' })).rejects.toThrow('关闭')
  expect(teamConversationStore.list(teamId)).toHaveLength(1)
})

test('known member IDs and forged team context cannot bypass access', async () => {
  const { context, teamId, workerSession } = setup()
  await expect(agentSessionCommunicationService.sendMessage({ context, targetSessionId: workerSession, content: 'bypass' })).rejects.toThrow()
  for (const [name, input] of [
    ['agent.session.messages', { sessionId: workerSession }],
    ['agent.session.watch', { sessionId: workerSession }],
    ['core.session.create', { agentId: sessionStore.get(workerSession)!.agent_id }],
    ['studio.task.createSimple', { title: 'bypass', selfExecute: false, assignee: sessionStore.get(workerSession)!.agent_id }],
    ['team.get', { teamId }],
  ] as const) {
    await expect(executeWithTeamBoundary(getHandler(name)!, input, { ...context, teamId, teamMemberId: 'forged' })).rejects.toThrow()
  }
})

test('copying a member preserves definition without sharing Agent ID, autonomy or private memory', () => {
  const { context } = setup()
  agentStore.update(context.agentId, { config: { skills: ['s'], autonomy: { enabled: true, memoryPath: 'private' } }, systemPrompt: 'definition' })
  const copy = copyTeamAgent(context.projectId, context.agentId)
  expect(copy.id).not.toBe(context.agentId)
  expect(copy.system_prompt).toBe('definition')
  expect(JSON.parse(copy.config_json!)).toMatchObject({ skills: ['s'], teamInternal: true })
  expect(JSON.parse(copy.config_json!).autonomy).toBeUndefined()
})

test('team to team contact supports replies and discovery from both sides', async () => {
  const { context, teamId, masterId } = setup()
  const local = createTeamConversation(teamId).conversation
  const other = teamStore.create({ name: 'Peer team', projectId: context.projectId })
  const peer = agentStore.create({ name: 'Peer Master', type: 'leader', runtime: 'mock', projectId: context.projectId, config: { teamInternal: true } })
  teamMemberStore.create({ teamId: other.id, projectId: context.projectId, agentId: peer.id, name: peer.name,
    role: 'leader', sessionId: sessionStore.create({ agentId: peer.id, projectId: context.projectId }).id })
  const sender = { ...context, agentId: masterId, sessionId: local.master_session_id }
  const result = await agentSessionCommunicationService.sendMessage({ context: sender, targetTeamId: other.id, content: 'request', needReply: true })
  const recipient = { ...context, agentId: peer.id, sessionId: result.targetSession.id }
  await agentSessionCommunicationService.sendMessage({ context: recipient, targetSessionId: sender.sessionId, content: 'reply' })
  expect(listPublicTeamConversations(sender, other.id)).toHaveLength(1)
  expect(listPublicTeamConversations(recipient, teamId)).toEqual([expect.objectContaining({ sessionId: sender.sessionId })])
  const followup = await agentSessionCommunicationService.sendMessage({ context: recipient, targetTeamId: teamId, content: 'follow up' })
  expect(followup.targetSession.id).toBe(sender.sessionId)
  expect(teamConversationStore.list(teamId)).toHaveLength(1)
  agentSessionMessageStore.updatePromptCompleted(result.message.id)
  const calls = vi.mocked(sessionManager.enqueuePrompt).mock.calls.length
  agentSessionCommunicationService.handleSessionDone({ sessionId: recipient.sessionId })
  expect(sessionManager.enqueuePrompt).toHaveBeenCalledTimes(calls)
})

test('private members cannot initiate external messages; closed sources create no contacts', async () => {
  const { context, teamId, workerSession } = setup()
  const worker = { ...context, agentId: sessionStore.get(workerSession)!.agent_id, sessionId: workerSession }
  await expect(agentSessionCommunicationService.sendMessage({ context: worker, targetSessionId: context.sessionId, content: 'escape' })).rejects.toThrow('Master')
  sessionStore.updateStatus(context.sessionId, 'closed')
  await expect(agentSessionCommunicationService.sendMessage({ context, targetTeamId: teamId, content: 'closed' })).rejects.toThrow('关闭')
  expect(teamConversationStore.list(teamId)).toEqual([])
})

test('discovery and both task lists hide private identities including step-only assignments', async () => {
  const { context, teamId, workerSession } = setup()
  const workerId = sessionStore.get(workerSession)!.agent_id
  const secret = taskStore.create({ title: 'Secret', description: '', projectId: context.projectId, teamId })
  const legacy = taskStore.create({ title: 'Legacy private step', description: '', projectId: context.projectId })
  taskStepStore.create({ taskId: legacy.id, title: 'Private', assigneeAgentId: workerId, sessionId: workerSession })
  const visible = taskStore.create({ title: 'Visible', description: '', projectId: context.projectId })
  for (const name of ['core.agent.list', 'core.session.list']) {
    const result = await executeWithTeamBoundary(getHandler(name)!, {}, context)
    expect(JSON.stringify(result)).not.toContain(workerId)
    expect(JSON.stringify(result)).not.toContain(workerSession)
  }
  for (const name of ['core.task.list', 'studio.task.list']) {
    const result = await executeWithTeamBoundary(getHandler(name)!, {}, context)
    expect(JSON.stringify(result)).not.toContain(secret.id)
    expect(JSON.stringify(result)).not.toContain(legacy.id)
    expect(JSON.stringify(result)).toContain(visible.id)
  }
  await expect(executeWithTeamBoundary(getHandler('studio.task.get')!, { taskId: legacy.id }, context)).rejects.toThrow()
})

test('deferred steps cannot create private sessions while legitimate team steps still execute', async () => {
  const { context, teamId, workerSession } = setup()
  const workerId = sessionStore.get(workerSession)!.agent_id
  const task = taskStore.create({ title: 'External task', description: '', projectId: context.projectId })
  taskStore.updateStatus(task.id, 'running')
  const step = taskStepStore.create({ taskId: task.id, title: 'Private assignment', assigneeAgentId: workerId })
  taskStepStore.updateStatus(step.id, 'ready')
  const create = vi.spyOn(sessionManager, 'createSession')
  await expect(dispatchStep(task.id, step.id)).rejects.toThrow('Master')
  expect(create).not.toHaveBeenCalled()
  const own = taskStore.create({ title: 'Internal task', description: '', projectId: context.projectId, teamId })
  taskStore.updateStatus(own.id, 'running')
  const ownStep = taskStepStore.create({ taskId: own.id, title: 'Allowed', assigneeAgentId: workerId, sessionId: workerSession })
  taskStepStore.updateStatus(ownStep.id, 'ready')
  await expect(dispatchStep(own.id, ownStep.id)).resolves.toMatchObject({ dispatched: true, sessionId: workerSession })
  const outbound = taskStepStore.create({ taskId: own.id, title: 'External assignment', assigneeAgentId: context.agentId, sessionId: context.sessionId })
  taskStepStore.updateStatus(outbound.id, 'ready')
  await expect(dispatchStep(own.id, outbound.id)).rejects.toThrow('Master')
})

test('pre-existing watches cannot reveal private member activity after upgrade', () => {
  const { context, workerSession } = setup()
  const watch = agentSessionWatchStore.create({ projectId: context.projectId, watcherAgentId: context.agentId, watcherSessionId: context.sessionId,
    watchedAgentId: sessionStore.get(workerSession)!.agent_id, watchedSessionId: workerSession })
  agentSessionCommunicationService.handleSessionDone({ sessionId: workerSession })
  expect(sessionManager.enqueuePrompt).not.toHaveBeenCalled()
  expect(agentSessionWatchStore.get(watch.id)?.status).toBe('failed')
})

test('model-visible team conversation schema retains target teamId and executes through the runtime boundary', async () => {
  const { context, teamId, masterId } = setup()
  seedBuiltinTools()
  const line = createTeamConversation(teamId).conversation
  const runtimeContext = { ...context, agentId: masterId, sessionId: line.master_session_id, teamId,
    workDir: temp, visibleTools: ['team.conversation.list'] }
  const tool = listRuntimeTools(runtimeContext)[0]
  expect(tool.inputSchema).toMatchObject({ properties: { teamId: { type: 'string' } }, required: ['teamId'] })
  const result = await executeRuntimeTool('team.conversation.list', { teamId }, runtimeContext)
  expect(result.isError).not.toBe(true)
  expect(result.content[0].text).toContain(line.master_session_id)
})
