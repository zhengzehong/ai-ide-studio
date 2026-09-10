import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { createTeamConversation } from '../../src/core/team-conversations.js'
import { reconcileTeamIdentities } from '../../src/core/team-identity-transition.js'
import { buildTeamRuntimePrompt } from '../../src/core/team-runtime-prompt.js'
import { assertSessionAccess, contextMember } from '../../src/core/team-access.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'

let temp: string
beforeEach(() => { temp = mkdtempSync(resolve(tmpdir(), 'team-transition-')); initDatabase(resolve(temp, 'test.sqlite')) })
afterEach(() => { closeDatabase(); rmSync(temp, { recursive: true, force: true }) })

function legacy(): { memberId: string; agentId: string; teamId: string; sessionId: string; conversationId: string; projectId: string } {
  const project = projectStore.create({ name: 'P', workDir: temp })
  const agent = agentStore.create({ projectId: project.id, type: 'leader', name: 'Shared', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  const team = teamStore.create({ projectId: project.id, name: 'Legacy' })
  const member = teamMemberStore.create({ teamId: team.id, projectId: project.id, agentId: agent.id, sessionId: session.id, role: 'leader', name: 'Master' })
  const conversation = createTeamConversation(team.id).conversation
  return { memberId: member.id, agentId: agent.id, teamId: team.id, sessionId: conversation.master_session_id, conversationId: conversation.id, projectId: project.id }
}

test('migration retargets future work and preserves historical messages and native mapping', () => {
  const old = legacy()
  sessionStore.updateAcpSessionId(old.sessionId, 'old-native-id')
  messageStore.append(old.sessionId, { role: 'agent', content: 'historical result', status: 'done' })
  const task = taskStore.create({ title: 'Pending', description: '', teamId: old.teamId, assigneeMemberId: old.memberId, projectId: old.projectId })
  taskStore.assignAgent(task.id, old.agentId)
  taskStore.setExecutionSession(task.id, old.agentId, old.sessionId)
  const step = taskStepStore.create({ taskId: task.id, title: 'Next', assigneeAgentId: old.agentId, sessionId: old.sessionId })
  expect(reconcileTeamIdentities()).toEqual({ migrated: 1, deferred: 0 })
  const member = teamMemberStore.get(old.memberId)!
  expect(member.agent_id).not.toBe(old.agentId)
  expect(member.session_id).not.toBe(old.sessionId)
  expect(sessionStore.get(old.sessionId)).toMatchObject({ agent_id: old.agentId, acp_session_id: 'old-native-id', status: 'closed' })
  expect(messageStore.list(old.sessionId)[0].content).toBe('historical result')
  expect(taskStore.get(task.id)?.assigned_agent_id).toBe(member.agent_id)
  expect(taskStepStore.get(step.id)).toMatchObject({ session_id: member.session_id, assignee_agent_id: member.agent_id })
  expect(teamConversationStore.get(old.conversationId)?.master_session_id).toBe(member.session_id)
  expect(buildTeamRuntimePrompt(member.session_id)).toContain(old.sessionId)
  expect(() => assertSessionAccess({ agentId: member.agent_id, sessionId: member.session_id, projectId: old.projectId }, old.sessionId)).not.toThrow()
  expect(() => contextMember({ agentId: old.agentId, sessionId: old.sessionId })).toThrow('迁移')
  expect(reconcileTeamIdentities()).toEqual({ migrated: 0, deferred: 0 })
})

test('busy legacy member is deferred without partial identity changes', () => {
  const old = legacy()
  getDb().prepare("UPDATE sessions SET stage = 'thinking' WHERE id = ?").run(old.sessionId)
  expect(reconcileTeamIdentities()).toEqual({ migrated: 0, deferred: 1 })
  expect(teamMemberStore.get(old.memberId)?.agent_id).toBe(old.agentId)
  getDb().prepare("UPDATE sessions SET stage = '' WHERE id = ?").run(old.sessionId)
  expect(reconcileTeamIdentities().migrated).toBe(1)
})

test('ordinary task tools used inside a team retain execution continuity without rewriting completed tasks', () => {
  const old = legacy()
  const pending = taskStore.create({ title: 'Self execution', description: '', projectId: old.projectId,
    initiatorAgentId: old.agentId, initiatorSessionId: old.sessionId })
  taskStore.assignAgent(pending.id, old.agentId)
  taskStore.setExecutionSession(pending.id, old.agentId, old.sessionId)
  const completed = taskStore.create({ title: 'Done', description: '', projectId: old.projectId, teamId: old.teamId })
  const untouched = taskStepStore.create({ taskId: completed.id, title: 'Historical', assigneeAgentId: old.agentId, sessionId: old.sessionId })
  taskStore.updateStatus(completed.id, 'completed')
  reconcileTeamIdentities()
  const member = teamMemberStore.get(old.memberId)!
  expect(taskStore.get(pending.id)).toMatchObject({ assigned_agent_id: member.agent_id, initiator_agent_id: member.agent_id, initiator_session_id: member.session_id })
  expect(taskStore.getExecutionSessionId(pending.id, member.agent_id)).toBe(member.session_id)
  expect(taskStepStore.get(untouched.id)).toMatchObject({ assignee_agent_id: old.agentId, session_id: old.sessionId })
})

test('cross-team reuse becomes distinct dedicated identities', () => {
  const old = legacy()
  const other = teamStore.create({ projectId: old.projectId, name: 'Other' })
  teamMemberStore.create({ teamId: other.id, projectId: old.projectId, agentId: old.agentId,
    sessionId: sessionStore.create({ agentId: old.agentId, projectId: old.projectId }).id, name: 'Master', role: 'leader' })
  expect(reconcileTeamIdentities().migrated).toBe(2)
  expect(teamMemberStore.list(other.id)[0].agent_id).not.toBe(teamMemberStore.get(old.memberId)?.agent_id)
  expect(agentStore.get(old.agentId)?.hidden_at).toBeNull()
})

test('ordinary sessions never attached to a team line remain active', () => {
  const old = legacy()
  const member = teamMemberStore.get(old.memberId)!
  const ordinary = sessionStore.create({ agentId: old.agentId, projectId: old.projectId })
  getDb().prepare('UPDATE team_members SET session_id = ? WHERE id = ?').run(ordinary.id, member.id)
  expect(reconcileTeamIdentities().migrated).toBe(1)
  expect(sessionStore.get(ordinary.id)?.status).toBe('active')
  expect(() => contextMember({ agentId: old.agentId, sessionId: ordinary.id })).not.toThrow()
  expect(teamMemberStore.get(old.memberId)?.session_id).not.toBe(ordinary.id)
})

test('ambiguous shared legacy session stays intact while both teams receive unique sessions', () => {
  const old = legacy()
  const other = teamStore.create({ projectId: old.projectId, name: 'Other' })
  const peer = teamMemberStore.create({ teamId: other.id, projectId: old.projectId, agentId: old.agentId,
    sessionId: old.sessionId, name: 'Master', role: 'leader' })
  expect(reconcileTeamIdentities().migrated).toBe(2)
  expect(sessionStore.get(old.sessionId)?.status).toBe('active')
  expect(teamMemberStore.get(peer.id)?.session_id).not.toBe(teamMemberStore.get(old.memberId)?.session_id)
  expect(teamMemberStore.get(peer.id)?.agent_id).not.toBe(old.agentId)
})
