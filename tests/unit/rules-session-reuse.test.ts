import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { ruleStore } from '../../src/store/rules.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { ruleEngine } from '../../src/core/rules.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-rule-session-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('rule session reuse', () => {
  test('scheduled create_task reuses configured session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const rule = ruleStore.create({
      name: 'Reuse task',
      cron: '* * * * *',
      action: 'create_task',
      projectId: project.id,
      actionConfig: {
        title: 'Scheduled reuse',
        assign_agent_id: agent.id,
        session_id: session.id,
      },
    })

    await ruleEngine.runNow(rule.id)

    const [task] = taskStore.list(undefined, project.id)
    expect(task).toMatchObject({
      title: 'Scheduled reuse',
      assigned_agent_id: agent.id,
      status: 'running',
    })
    expect(taskStore.listSessionIds(task.id)).toEqual([session.id])
  })

  test('scheduled create_task new_fixed stores and reuses the first created session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const rule = ruleStore.create({
      name: 'Fixed task',
      cron: '* * * * *',
      action: 'create_task',
      projectId: project.id,
      actionConfig: {
        title: 'Scheduled fixed',
        assign_agent_id: agent.id,
        session_mode: 'new_fixed',
      },
    })

    await ruleEngine.runNow(rule.id)
    const storedAfterFirst = ruleStore.get(rule.id)
    const fixedSessionId = storedAfterFirst?.action_config.session_id
    expect(fixedSessionId).toBeTruthy()

    await ruleEngine.runNow(rule.id)

    const tasks = taskStore.list(undefined, project.id)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((task) => taskStore.listSessionIds(task.id))).toEqual([[fixedSessionId], [fixedSessionId]])
    expect(ruleStore.get(rule.id)?.action_config.session_id).toBe(fixedSessionId)
  })

  test('scheduled send_prompt rejects sessions outside target agent', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const targetAgent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const otherAgent = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })
    const otherSession = sessionStore.create({ agentId: otherAgent.id, projectId: project.id })
    const rule = ruleStore.create({
      name: 'Bad prompt',
      cron: '* * * * *',
      action: 'send_prompt',
      projectId: project.id,
      actionConfig: {
        prompt: 'hello',
        agent_id: targetAgent.id,
        session_id: otherSession.id,
      },
    })

    await ruleEngine.runNow(rule.id)

    const updated = ruleStore.get(rule.id)
    expect(updated?.fail_count).toBe(1)
  })

  test('scheduled send_prompt new_fixed stores the created session target', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const targetAgent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const rule = ruleStore.create({
      name: 'Fixed prompt',
      cron: '* * * * *',
      action: 'send_prompt',
      projectId: project.id,
      actionConfig: {
        prompt: 'hello',
        agent_id: targetAgent.id,
        session_mode: 'new_fixed',
      },
    })

    await ruleEngine.runNow(rule.id)

    const fixedSessionId = ruleStore.get(rule.id)?.action_config.session_id
    expect(fixedSessionId).toBeTruthy()
    expect(sessionStore.get(fixedSessionId!)).toMatchObject({ agent_id: targetAgent.id, project_id: project.id })
  })

  test('creates one scheduled task across thirty repeated triggers until its prompt settles', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const gate = deferred<void>()
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => gate.promise)
    const rule = ruleStore.create({
      name: 'No duplicate task',
      cron: '* * * * *',
      action: 'create_task',
      projectId: project.id,
      actionConfig: {
        title: 'Only one task',
        assign_agent_id: agent.id,
        session_id: session.id,
      },
    })

    const triggers = Array.from({ length: 30 }, () => ruleEngine.runNow(rule.id))
    await waitUntil(() => enqueuePrompt.mock.calls.length === 1)

    expect(taskStore.list(undefined, project.id)).toHaveLength(1)
    expect(enqueuePrompt).toHaveBeenCalledTimes(1)

    gate.resolve()
    await Promise.all(triggers)
    expect(taskStore.list(undefined, project.id)).toHaveLength(1)

    await ruleEngine.runNow(rule.id)
    expect(taskStore.list(undefined, project.id)).toHaveLength(2)
  })

  test('keeps thirty repeated send_prompt triggers to one pending rule prompt', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const gate = deferred<void>()
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => gate.promise)
    const rule = ruleStore.create({
      name: 'No duplicate prompt',
      cron: '* * * * *',
      action: 'send_prompt',
      projectId: project.id,
      actionConfig: {
        prompt: '检查当前状态',
        agent_id: agent.id,
        session_id: session.id,
      },
    })

    const triggers = Array.from({ length: 30 }, () => ruleEngine.runNow(rule.id))
    await waitUntil(() => enqueuePrompt.mock.calls.length === 1)

    expect(enqueuePrompt).toHaveBeenCalledWith(
      session.id,
      '检查当前状态',
      undefined,
      expect.objectContaining({ dedupeKey: `rule:${rule.id}` }),
    )

    gate.resolve()
    await Promise.all(triggers)
    await ruleEngine.runNow(rule.id)
    expect(enqueuePrompt).toHaveBeenCalledTimes(2)
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for queued prompt')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  }
}
