import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { taskStore } from '../../src/store/tasks.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { acpHost } from '../../src/acp/host.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-project-cwd-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('ACP session project context', () => {
  test('session creation stores project_id and passes project work_dir to ACP host', async () => {
    const workDir = resolve(tmp, 'project-a')
    const project = projectStore.create({ name: '项目 A', workDir })
    const agent = agentStore.create({ name: '工程师', type: 'dev', runtime: 'mock', projectId: project.id })
    const task = taskStore.create({ title: '实现功能', projectId: project.id, assignAgentId: agent.id })

    const originalIsRunning = acpHost.isRunning
    const originalStartAgent = acpHost.startAgent
    const originalNewSession = acpHost.newSession
    const calls: Array<{ agentId: string; sessionId: string; projectId?: string; cwd?: string }> = []

    acpHost.isRunning = (() => true) as typeof acpHost.isRunning
    acpHost.startAgent = (async () => undefined) as typeof acpHost.startAgent
    acpHost.newSession = (async (agentId, ourSessionId, context) => {
      calls.push({ agentId, sessionId: ourSessionId, projectId: context?.projectId, cwd: context?.cwd })
      return `acp-${ourSessionId}`
    }) as typeof acpHost.newSession

    try {
      const created = await sessionManager.createSession(agent.id, task.id)
      const stored = sessionStore.get(created.id)

      expect(stored?.project_id).toBe(project.id)
      expect(calls).toEqual([{ agentId: agent.id, sessionId: created.id, projectId: project.id, cwd: workDir }])
    } finally {
      acpHost.isRunning = originalIsRunning
      acpHost.startAgent = originalStartAgent
      acpHost.newSession = originalNewSession
    }
  })
})
