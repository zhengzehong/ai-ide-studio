import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-rule-session-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
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
})
