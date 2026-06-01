import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService, type TeamContextDetail } from '../../src/core/teams.js'
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

    const created = teamService.create({
      projectId: project.id,
      leaderAgentId: leader.id,
      leaderSessionId: leaderSession.id,
      name: 'Alpha',
    })
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
    const created = teamService.create({
      projectId: project.id,
      leaderAgentId: leader.id,
      leaderSessionId: leaderSession.id,
      name: 'Alpha',
    })
    const spawned = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id, role: 'worker' })

    const data = await callTeamsCurrent(spawned.session.id)

    expect(data.team).toMatchObject({ id: created.team.id })
    expect(data.currentMember).toMatchObject({ id: spawned.member.id, role: 'worker', session_id: spawned.session.id })
    expect(data.members.map((member) => member.id)).toEqual([created.member.id, spawned.member.id])
  })
})

async function callTeamsCurrent(sessionId: string): Promise<TeamContextDetail> {
  let result: unknown
  await teamRpcHandlers['teams.current'](
    { type: 'teams.current', sessionId },
    {
      state: { subscriptions: new Set() },
      sendResult: (data) => {
        result = data
      },
      sendError: (message) => {
        throw new Error(message)
      },
      sendOutOfBandError: (message) => {
        throw new Error(message)
      },
    },
  )
  return result as TeamContextDetail
}
