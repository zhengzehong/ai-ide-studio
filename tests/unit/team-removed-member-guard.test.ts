import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'
import { teamMemberStore } from '../../src/store/teams.js'
import { teamService } from '../../src/core/teams.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'team-removed-member-guard-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  vi.spyOn(sessionManager, 'isPromptActive').mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createFixture(): { teamId: string; memberId: string; conversationId: string; masterSessionId: string } {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
  const { team } = teamService.create({
    projectId: project.id, leaderAgentId: leader.id, leaderSessionId: leaderSession.id, name: 'Alpha',
  })
  const { member } = teamService.spawnMember({ teamId: team.id, agentId: worker.id })
  const conversation = teamService.createConversation(team.id)
  return { teamId: team.id, memberId: member.id, conversationId: conversation.conversation.id, masterSessionId: conversation.conversation.master_session_id }
}

test('rejects dispatching work to a removed member and creates no grid session', () => {
  const fixture = createFixture()
  const gridsBefore = teamConversationStore.listMembers(fixture.conversationId).length
  const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue()
  teamMemberStore.remove(fixture.memberId)

  expect(() => teamService.dispatchMessage({
    teamId: fixture.teamId, memberId: fixture.memberId,
    sourceSessionId: fixture.masterSessionId, content: '已移除成员不应收到派活',
  })).toThrow('该成员已从团队移除')

  // 派活被拒：没有任何 prompt 进队；格子补建未发生（不新增格子会话）。
  expect(enqueue).not.toHaveBeenCalled()
  expect(teamConversationStore.listMembers(fixture.conversationId).length).toBe(gridsBefore)
})

test('rejects assigning team tasks to a removed member', () => {
  const fixture = createFixture()
  teamMemberStore.remove(fixture.memberId)

  expect(() => teamService.createTask({
    teamId: fixture.teamId, title: '已移除成员的任务', assigneeMemberId: fixture.memberId,
  })).toThrow('该成员已从团队移除')

  // 指派路径同样被拒：更新已有任务指派给已移除成员也报错，且指派未落库。
  const task = teamService.createTask({ teamId: fixture.teamId, title: '普通任务' })
  expect(() => teamService.updateTask({
    teamId: fixture.teamId, taskId: task.id, assigneeMemberId: fixture.memberId,
  })).toThrow('该成员已从团队移除')
  expect(taskStore.get(task.id)?.assignee_member_id ?? null).toBeNull()
})

test('rejects team mailbox messages involving a removed member', () => {
  const fixture = createFixture()
  teamMemberStore.remove(fixture.memberId)

  expect(() => teamService.sendMailbox({
    teamId: fixture.teamId, type: 'message', content: '发给已移除成员', toMemberId: fixture.memberId,
  })).toThrow('该成员已从团队移除')
  expect(() => teamService.sendMailbox({
    teamId: fixture.teamId, type: 'message', content: '以已移除成员身份发送', fromMemberId: fixture.memberId,
  })).toThrow('该成员已从团队移除')
})

test('re-adding the member restores dispatch', () => {
  const fixture = createFixture()
  const member = teamMemberStore.get(fixture.memberId)!
  teamMemberStore.remove(fixture.memberId)
  teamMemberStore.create({
    teamId: fixture.teamId, projectId: member.project_id, agentId: member.agent_id,
    sessionId: member.session_id, name: member.name, role: 'member',
  })
  expect(() => teamService.sendMailbox({
    teamId: fixture.teamId, type: 'message', content: '重新添加后恢复派发', toMemberId: fixture.memberId,
  })).not.toThrow()
})
