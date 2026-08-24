import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { taskStore } from '../../src/store/tasks.js'
import { dispatchStep } from '../../src/core/step-dispatch.js'
import { sessionManager } from '../../src/core/sessions.js'
import { taskStepManager } from '../../src/core/task-steps.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-step-dispatch-rejection-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(root, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('step dispatch prompt rejection', () => {
  test('rolls back task state without emitting an unhandled rejection', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const assignee = agentStore.create({
      name: 'Developer',
      type: 'developer',
      runtime: 'mock',
      projectId: project.id,
    })
    const task = taskStore.create({ title: 'Task', description: 'Run work', projectId: project.id })
    const added = taskStepManager.addStep({ taskId: task.id, title: 'Implement', assignee: assignee.id })
    taskStore.updateStatus(task.id, 'running', 'Started')
    taskStepStore.updateStatus(added.step.id, 'ready')

    const rejection = new Error('ACP session resume failed')
    vi.spyOn(sessionManager, 'enqueuePrompt').mockReturnValue(Promise.reject(rejection))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.prependListener('unhandledRejection', onUnhandled)

    try {
      await expect(dispatchStep(task.id, added.step.id)).resolves.toMatchObject({
        stepId: added.step.id,
      })
      await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate))

      expect(taskStepStore.get(added.step.id)?.status).toBe('ready')
      expect(taskStore.get(task.id)).toMatchObject({
        status: 'needs_input',
        stage: expect.stringContaining('ACP session resume failed'),
      })
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('claims a ready step only once when dispatch is repeated', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const assignee = agentStore.create({
      name: 'Developer', type: 'developer', runtime: 'mock', projectId: project.id,
    })
    const task = taskStore.create({ title: 'Task', description: 'Run work', projectId: project.id })
    const added = taskStepManager.addStep({ taskId: task.id, title: 'Implement', assignee: assignee.id })
    taskStore.updateStatus(task.id, 'running', 'Started')
    taskStepStore.updateStatus(added.step.id, 'ready')
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const first = await dispatchStep(task.id, added.step.id)
    const second = await dispatchStep(task.id, added.step.id)

    expect(first.dispatched).toBe(true)
    expect(second.dispatched).toBe(false)
    expect(taskStepStore.get(added.step.id)?.status).toBe('running')
  })
})
