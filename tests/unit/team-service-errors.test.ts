import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamService } from '../../src/core/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-errors-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team service error messages', () => {
  test('returns readable Chinese when Team is missing', () => {
    expect(() => teamService.detail('team-missing')).toThrow('Team 不存在: team-missing')
  })

  test('returns readable Chinese when project is missing', () => {
    expect(() =>
      teamService.create({
        projectId: 'project-missing',
        leaderAgentId: 'agent-missing',
        name: 'Alpha',
      }),
    ).toThrow('项目不存在: project-missing')
  })

  test('returns readable Chinese when a member updates another member task', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const owner = agentStore.create({ name: 'Owner', type: 'dev', runtime: 'mock', projectId: project.id })
    const other = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })
    const leaderSession = sessionStore.create({ agentId: leader.id, projectId: project.id })
    const created = teamService.create({
      projectId: project.id,
      leaderAgentId: leader.id,
      leaderSessionId: leaderSession.id,
      name: 'Alpha',
    })
    const ownerMember = teamService.spawnMember({ teamId: created.team.id, agentId: owner.id }).member
    const otherMember = teamService.spawnMember({ teamId: created.team.id, agentId: other.id }).member
    const task = teamService.createTask({
      teamId: created.team.id,
      title: '实现测试任务',
      assigneeMemberId: ownerMember.id,
    })

    expect(() =>
      teamService.updateTask({
        teamId: created.team.id,
        taskId: task.id,
        status: 'completed',
        actor: { teamMemberId: otherMember.id },
      }),
    ).toThrow('只能更新分配给自己的 Team 任务')
  })
})
