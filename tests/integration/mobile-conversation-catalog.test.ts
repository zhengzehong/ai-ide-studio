import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamStore, teamMemberStore } from '../../src/store/teams.js'
import { createTeamConversation, archiveTeamConversation, deleteTeamConversation } from '../../src/core/team-conversations.js'
import { listMobileConversationCatalog } from '../../src/core/mobile-conversations.js'
import { globalSessionDockStore } from '../../src/store/global-session-dock.js'
import { listGlobalSessionDockItems } from '../../src/queries/global-session-dock-query.js'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'mobile-team-catalog-')); initDatabase(join(directory, 'test.sqlite')) })
afterEach(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }) })

function fixture(): { projectId: string; teamId: string; agentId: string } {
  const project = projectStore.create({ name: '项目', workDir: directory })
  const agent = agentStore.create({ name: 'Master', type: 'dev', runtime: 'mock', projectId: project.id, config: { teamInternal: true } })
  const team = teamStore.create({ projectId: project.id, name: '测试组' })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  teamMemberStore.create({ teamId: team.id, projectId: project.id, agentId: agent.id, sessionId: session.id, role: 'leader', name: 'Master' })
  return { projectId: project.id, teamId: team.id, agentId: agent.id }
}

describe('mobile conversation catalog', () => {
  it('aggregates two conversations, excludes other projects and reports runtime independently of active status', () => {
    const f = fixture()
    const first = createTeamConversation(f.teamId)
    const second = createTeamConversation(f.teamId)
    const other = fixture()
    createTeamConversation(other.teamId)
    const result = listMobileConversationCatalog(f.projectId, id => id === second.conversation.master_session_id)
    expect(result.teams.map(team => team.id)).toEqual([f.teamId])
    expect(result.hiddenAgentIds).toEqual([f.agentId])
    expect(result.conversations).toHaveLength(2)
    expect(result.conversations.find(c => c.id === first.conversation.id)?.running).toBe(false)
    expect(result.conversations.find(c => c.id === second.conversation.id)?.running).toBe(true)
    expect(result.hiddenSessionIds).toContain(first.conversation.master_session_id)
  })
  it('keeps archived and deleted session IDs suppressed and reuses existing dock keys', () => {
    const f = fixture()
    const first = createTeamConversation(f.teamId)
    const second = createTeamConversation(f.teamId)
    globalSessionDockStore.add(first.conversation.master_session_id)
    expect(listGlobalSessionDockItems(() => false).map(item => item.sessionId)).toContain(first.conversation.master_session_id)
    archiveTeamConversation(first.conversation.id)
    deleteTeamConversation(second.conversation.id)
    const result = listMobileConversationCatalog(f.projectId, () => false)
    expect(result.conversations).toEqual([])
    expect(result.hiddenSessionIds).toEqual(expect.arrayContaining([first.conversation.master_session_id, second.conversation.master_session_id]))
  })
})
