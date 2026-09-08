import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { teamService } from '../../src/core/teams.js'
import { teamConversationStore } from '../../src/store/team-conversations.js'

let tempDir: string

beforeEach(() => { tempDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-conversations-')); initDatabase(resolve(tempDir, 'app.sqlite')) })
afterEach(() => { closeDatabase(); rmSync(tempDir, { recursive: true, force: true }) })

describe('team conversation store', () => {
  test('supports multiple isolated conversations for one team', () => {
    const project = projectStore.create({ name: 'Project', workDir: tempDir })
    const leader = agentStore.create({ name: 'Master', type: 'architect', runtime: 'mock', projectId: project.id })
    const worker = agentStore.create({ name: 'Reviewer', type: 'test', runtime: 'mock', projectId: project.id })
    const team = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Bug 团' })
    teamService.spawnMember({ teamId: team.team.id, agentId: worker.id, role: 'reviewer' })

    const first = teamService.createConversation(team.team.id, '登录超时')
    const second = teamService.createConversation(team.team.id, '发布检查')

    expect(teamService.listConversations(team.team.id)).toHaveLength(2)
    expect(first.conversation.master_session_id).not.toBe(second.conversation.master_session_id)
    expect(first.members).toHaveLength(2)
    expect(first.members.map((member) => member.session_id)).not.toContain(second.conversation.master_session_id)
  })

  test('assigns a monotonic sequence to unified messages', () => {
    const project = projectStore.create({ name: 'Project', workDir: tempDir })
    const leader = agentStore.create({ name: 'Master', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Bug 团' })
    const conversation = teamService.createConversation(team.team.id, 'Issue')
    const first = teamConversationStore.appendMessage({ conversation_id: conversation.conversation.id, source: 'user', agent_id: null, member_id: null, session_id: conversation.conversation.master_session_id, kind: 'text', content_json: JSON.stringify({ content: '开始' }), source_message_id: 'source-1' })
    const second = teamConversationStore.appendMessage({ conversation_id: conversation.conversation.id, source: 'master', agent_id: leader.id, member_id: team.member.id, session_id: conversation.conversation.master_session_id, kind: 'text', content_json: JSON.stringify({ content: '收到' }), source_message_id: 'source-2' })
    expect([first.sequence, second.sequence]).toEqual([1, 2])
    expect(teamConversationStore.listMessages(conversation.conversation.id).map((row) => row.sequence)).toEqual([1, 2])
  })

  test('keeps conversation lifecycle scoped to one Team', () => {
    const project = projectStore.create({ name: 'Project', workDir: tempDir })
    const leader = agentStore.create({ name: 'Master', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Bug Team' })
    const conversation = teamService.createConversation(team.team.id, 'Initial')

    expect(teamService.renameConversation(conversation.conversation.id, 'Renamed').title).toBe('Renamed')
    expect(teamService.archiveConversation(conversation.conversation.id).status).toBe('archived')
    expect(teamService.listConversations(team.team.id)).toHaveLength(1)
    expect(teamService.deleteConversation(conversation.conversation.id).status).toBe('deleted')
    expect(teamService.listConversations(team.team.id)).toHaveLength(0)
  })
})
