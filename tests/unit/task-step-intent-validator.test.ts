import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { taskStepManager } from '../../src/core/task-steps.js'
import { taskStepIntentValidator } from '../../src/core/task-step-intent-validator.js'
import { sessionManager } from '../../src/core/sessions.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-step-intent-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(root, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('task-step prompt intent validator', () => {
  test('accepts a running step assigned to the dispatch session', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Developer', type: 'developer', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: 'Task', description: 'Run work', projectId: project.id })
    const session = await sessionManager.createSession(agent.id, task.id, project.id)
    const added = taskStepManager.addStep({ taskId: task.id, title: 'Implement', sessionId: session.id })
    taskStore.updateStatus(task.id, 'running', 'Started')
    taskStepStore.updateStatus(added.step.id, 'running')

    expect(taskStepIntentValidator.validate({
      source: 'task-step', taskId: task.id, stepId: added.step.id, sessionId: session.id,
    })).toEqual({ valid: true })
  })

  test('rejects a step that completed while its prompt was queued', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Developer', type: 'developer', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: 'Task', description: 'Run work', projectId: project.id })
    const session = await sessionManager.createSession(agent.id, task.id, project.id)
    const added = taskStepManager.addStep({ taskId: task.id, title: 'Implement', sessionId: session.id })
    taskStore.updateStatus(task.id, 'running', 'Started')
    taskStepStore.updateStatus(added.step.id, 'done')

    expect(taskStepIntentValidator.validate({
      source: 'task-step', taskId: task.id, stepId: added.step.id, sessionId: session.id,
    })).toEqual({ valid: false, reason: 'step-done' })
  })
})
