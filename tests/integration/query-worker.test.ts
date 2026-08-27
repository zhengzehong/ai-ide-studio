import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskStepStore } from '../../src/store/task-steps.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { createLocalQueryPort } from '../../src/queries/local-query-port.js'
import {
  createWorkerQueryPort,
  type WorkerQueryPort,
} from '../../src/queries/worker-query-port.js'

let tmp: string
let dbPath: string
let workerPort: WorkerQueryPort | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-query-worker-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
})

afterEach(async () => {
  await workerPort?.close()
  workerPort = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Query Worker', () => {
  it('matches all Phase 1 read models using a read-only connection', async () => {
    const project = projectStore.create({ name: 'Query Worker Project', workDir: 'D:/query-worker' })
    const projectId = project.id
    const agent = agentStore.create({
      name: 'Query Worker Agent',
      type: 'dev',
      runtime: 'mock',
      projectId,
    })
    const task = taskStore.create({ title: 'Worker task', projectId })
    const step = taskStepStore.create({ taskId: task.id, title: 'Worker step' })
    taskStepStore.updateStatus(step.id, 'done')
    const session = sessionStore.create({ agentId: agent.id, projectId, taskId: task.id })
    const firstMessage = messageStore.append(session.id, { role: 'user', content: 'first' })
    messageStore.append(session.id, { role: 'agent', content: 'second' })
    eventStore.append(session.id, {
      type: 'message.user',
      messageId: firstMessage.id,
      role: 'user',
      payload: { content: 'first' },
    })
    const local = createLocalQueryPort({ isPromptActive: (id) => id === session.id })
    const expected = {
      tasks: await local.listTasks({ projectId }),
      taskPage: await local.listTaskPage({ projectId, limit: 20 }),
      sessions: await local.listSessions({ projectId }),
      messages: await local.listSessionMessages({ sessionId: session.id, limit: 20 }),
      events: await local.listSessionEvents({ sessionId: session.id, limit: 20 }),
      recovery: await local.getSessionRecovery({ sessionId: session.id, limit: 20 }),
      widgetSessions: await local.listWidgetSessions({
        projectId,
        activePromptSessionIds: [session.id],
      }),
    }
    closeDatabase()

    workerPort = await createWorkerQueryPort({
      dbPath,
      getActivePromptSessionIds: () => [session.id],
      allowDiagnostics: true,
    })

    await expect(workerPort.listTasks({ projectId })).resolves.toEqual(expected.tasks)
    await expect(workerPort.listTaskPage({ projectId, limit: 20 })).resolves.toEqual(expected.taskPage)
    await expect(workerPort.listSessions({ projectId })).resolves.toEqual(expected.sessions)
    await expect(workerPort.listSessionMessages({ sessionId: session.id, limit: 20 }))
      .resolves.toEqual(expected.messages)
    await expect(workerPort.listSessionEvents({ sessionId: session.id, limit: 20 }))
      .resolves.toEqual(expected.events)
    await expect(workerPort.getSessionRecovery({ sessionId: session.id, limit: 20 }))
      .resolves.toEqual(expected.recovery)
    await expect(workerPort.listWidgetSessions({ projectId })).resolves.toEqual(expected.widgetSessions)
    await expect(workerPort.inspect()).resolves.toMatchObject({
      mode: 'readonly',
      queryOnly: true,
    })
  })

  it('rejects writes from the query connection', async () => {
    closeDatabase()
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })

    await expect(workerPort.diagnose({ attemptWrite: true })).rejects.toMatchObject({
      code: 'SQLITE_ERROR',
    })
  })

  it('reports a foreign task cursor as a bad request', async () => {
    const firstProjectTask = taskStore.create({ title: 'First project', projectId: 'project-a' })
    closeDatabase()
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })

    await expect(workerPort.listTaskPage({ projectId: 'project-b', cursor: firstProjectTask.id }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('keeps the caller event loop responsive while prioritizing queued interactive work', async () => {
    closeDatabase()
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    const intervalGaps: number[] = []
    let lastTick = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      intervalGaps.push(now - lastTick)
      lastTick = now
    }, 10)
    const completionOrder: string[] = []

    const blocker = workerPort
      .diagnose({ label: 'blocker', blockMs: 150 }, { priority: 'interactive' })
      .then(() => completionOrder.push('blocker'))
    await delay(20)
    const background = workerPort
      .diagnose({ label: 'background' }, { priority: 'background' })
      .then(() => completionOrder.push('background'))
    const interactive = workerPort
      .diagnose({ label: 'interactive' }, { priority: 'interactive' })
      .then(() => completionOrder.push('interactive'))

    await Promise.all([blocker, background, interactive])
    clearInterval(timer)

    expect(completionOrder).toEqual(['blocker', 'interactive', 'background'])
    expect(Math.max(...intervalGaps)).toBeLessThan(75)
  })

  it('rejects expired work and isolates termination from a restarted worker', async () => {
    closeDatabase()
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })

    await expect(
      workerPort.diagnose({ label: 'expired' }, { priority: 'background', deadlineMs: -1 }),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })

    await workerPort.terminate()
    await expect(workerPort.listTasks({})).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })

    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    await expect(workerPort.listTasks({})).resolves.toEqual([])
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
