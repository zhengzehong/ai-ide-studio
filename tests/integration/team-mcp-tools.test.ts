import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamEventStore, teamMailboxStore, teamMemberStore, teamStore } from '../../src/store/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Team MCP 数据模型', () => {
  test('迁移创建 Team 表并扩展 tasks 团队字段', () => {
    const tables = getDb().prepare<[], { name: string }>(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('teams', 'team_members', 'team_mailbox', 'team_events')
      ORDER BY name
    `).all().map(row => row.name)
    const taskColumns = getDb().prepare<[], { name: string }>('PRAGMA table_info(tasks)').all().map(row => row.name)
    const migrations = getDb().prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version)

    expect(tables).toEqual(['team_events', 'team_mailbox', 'team_members', 'teams'])
    expect(taskColumns).toEqual(expect.arrayContaining(['team_id', 'assignee_member_id']))
    expect(migrations).toContain('005')
  })

  test('Team store 串起 team、member、mailbox、event 和 team task', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const team = teamStore.create({ projectId: project.id, name: 'Alpha', description: '协作组' })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      name: 'Leader',
      role: 'leader',
    })
    const task = taskStore.create({
      title: '补测试',
      source: 'agent',
      projectId: project.id,
      teamId: team.id,
      assigneeMemberId: member.id,
      assignAgentId: agent.id,
    })
    const mailbox = teamMailboxStore.create({
      teamId: team.id,
      projectId: project.id,
      fromMemberId: member.id,
      type: 'report',
      content: '已开始',
      taskId: task.id,
    })
    const event = teamEventStore.append(team.id, {
      type: 'mailbox.created',
      payload: { mailboxId: mailbox.id },
    })

    expect(teamStore.list(project.id).map(row => row.id)).toEqual([team.id])
    expect(teamMemberStore.list(team.id).map(row => row.id)).toEqual([member.id])
    expect(taskStore.listByTeam(team.id).map(row => row.id)).toEqual([task.id])
    expect(teamMailboxStore.list(team.id).map(row => row.id)).toEqual([mailbox.id])
    expect(teamEventStore.list(team.id).map(row => row.id)).toContain(event.id)
  })
})
