import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { ruleStore } from '../../src/store/rules.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-project-scope-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('project scoped entities', () => {
  test('agents, sessions, tasks, and rules are isolated by projectId', () => {
    const projectA = projectStore.create({ name: '项目 A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: '项目 B', workDir: resolve(tmp, 'b') })

    const agentA = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ type: 'dev', name: 'Agent B', runtime: 'mock', projectId: projectB.id })

    const taskA = taskStore.create({ title: '任务 A', projectId: projectA.id, assignAgentId: agentA.id })
    const taskB = taskStore.create({ title: '任务 B', projectId: projectB.id, assignAgentId: agentB.id })

    const sessionA = sessionStore.create({ agentId: agentA.id, taskId: taskA.id, projectId: projectA.id })
    const sessionB = sessionStore.create({ agentId: agentB.id, taskId: taskB.id, projectId: projectB.id })

    const ruleA = ruleStore.create({ name: '规则 A', projectId: projectA.id, cron: '* * * * *', action: 'create_task', actionConfig: { title: '规则任务 A' } })
    const ruleB = ruleStore.create({ name: '规则 B', projectId: projectB.id, cron: '* * * * *', action: 'create_task', actionConfig: { title: '规则任务 B' } })

    expect(agentStore.list(projectA.id).map(a => a.id)).toEqual([agentA.id])
    expect(agentStore.list(projectB.id).map(a => a.id)).toEqual([agentB.id])
    expect(taskStore.list(undefined, projectA.id).map(t => t.id)).toEqual([taskA.id])
    expect(taskStore.list(undefined, projectB.id).map(t => t.id)).toEqual([taskB.id])
    expect(sessionStore.list(undefined, projectA.id).map(s => s.id)).toEqual([sessionA.id])
    expect(sessionStore.list(undefined, projectB.id).map(s => s.id)).toEqual([sessionB.id])
    expect(ruleStore.list(projectA.id).map(r => r.id)).toEqual([ruleA.id])
    expect(ruleStore.list(projectB.id).map(r => r.id)).toEqual([ruleB.id])
  })
})
