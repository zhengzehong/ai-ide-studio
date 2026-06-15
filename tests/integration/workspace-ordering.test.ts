import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-workspace-ordering-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('workspace custom ordering persistence', () => {
  test('migrates agents and sessions with sort_order columns', () => {
    const agentColumns = getDb().prepare<[], { name: string }>('PRAGMA table_info(agents)').all().map((row) => row.name)
    const sessionColumns = getDb().prepare<[], { name: string }>('PRAGMA table_info(sessions)').all().map((row) => row.name)

    expect(agentColumns).toContain('sort_order')
    expect(agentColumns).toContain('hidden_at')
    expect(sessionColumns).toContain('sort_order')
  })

  test('lists agents by custom order inside a project', () => {
    const project = projectStore.create({ name: 'Ordering', workDir: resolve(tmp, 'ordering') })
    const first = agentStore.create({ type: 'dev', name: 'First', runtime: 'mock', projectId: project.id })
    const second = agentStore.create({ type: 'dev', name: 'Second', runtime: 'mock', projectId: project.id })
    const third = agentStore.create({ type: 'dev', name: 'Third', runtime: 'mock', projectId: project.id })

    agentStore.reorder(project.id, [third.id, first.id, second.id])

    expect(agentStore.list(project.id).map((agent) => agent.id)).toEqual([third.id, first.id, second.id])
  })

  test('lists sessions by custom order inside an agent', () => {
    const project = projectStore.create({ name: 'Ordering', workDir: resolve(tmp, 'ordering') })
    const agent = agentStore.create({ type: 'dev', name: 'Agent', runtime: 'mock', projectId: project.id })
    const first = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const second = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const third = sessionStore.create({ agentId: agent.id, projectId: project.id })

    sessionStore.reorder(project.id, agent.id, [third.id, first.id, second.id])

    expect(sessionStore.list(agent.id, project.id).map((session) => session.id)).toEqual([third.id, first.id, second.id])
  })

  test('persists project agent hidden state', () => {
    const project = projectStore.create({ name: 'Visibility', workDir: resolve(tmp, 'visibility') })
    const agent = agentStore.create({ type: 'dev', name: 'Hidden Agent', runtime: 'mock', projectId: project.id })

    const hidden = agentStore.setHidden(agent.id, true)

    expect(hidden.hidden_at).toEqual(expect.any(String))
    expect(agentStore.get(agent.id)?.hidden_at).toEqual(hidden.hidden_at)

    const visible = agentStore.setHidden(agent.id, false)

    expect(visible.hidden_at).toBeNull()
    expect(agentStore.get(agent.id)?.hidden_at).toBeNull()
  })
})
