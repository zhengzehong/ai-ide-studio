import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { taskStore } from '../../src/store/tasks.js'
import { acpHost } from '../../src/acp/host.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-core-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('core MCP tool handlers', () => {
  test('creates, lists, and gets projects', async () => {
    const created = await executeJson('core.project.create', { name: '平台', workDir: tmp, description: '核心项目' })
    expect(asRecord(created.project)).toMatchObject({ name: '平台', work_dir: tmp, description: '核心项目' })

    const listed = await executeJson('core.project.list', {})
    const projects = asRecords(listed.projects)
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(asRecord(created.project).id)

    const got = await executeJson('core.project.get', { projectId: asRecord(created.project).id })
    expect(asRecord(got.project).id).toBe(asRecord(created.project).id)
  })

  test('creates custom agents in the current project when projectId is omitted', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    const created = await executeJson('core.agent.create', { name: 'Dev', type: 'dev', runtime: 'mock' }, { projectId: project.id })
    expect(asRecord(created.agent)).toMatchObject({ name: 'Dev', type: 'dev', runtime: 'mock', project_id: project.id })

    const listed = await executeJson('core.agent.list', {}, { projectId: project.id })
    expect(asRecords(listed.agents).map(agent => agent.id)).toEqual([asRecord(created.agent).id])

    const got = await executeJson('core.agent.get', { agentId: asRecord(created.agent).id })
    expect(asRecord(got.agent).id).toBe(asRecord(created.agent).id)
  })

  test('creates agents from templates', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const template = templateStore.create({ name: '模板工程师', type: 'dev', runtime: 'mock', systemPrompt: '按规范工作' })

    const created = await executeJson('core.agent.create', { templateId: template.id }, { projectId: project.id })

    expect(asRecord(created.agent)).toMatchObject({ name: '模板工程师', type: 'dev', runtime: 'mock', project_id: project.id, template_id: template.id })
  })

  test('creates, lists, and gets sessions through the session manager', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock', projectId: project.id })

    try {
      const created = await executeJson('core.session.create', { agentId: agent.id }, { projectId: project.id })
      expect(asRecord(created.session)).toMatchObject({ agent_id: agent.id, project_id: project.id, status: 'active', acp_session_id: null })

      const listed = await executeJson('core.session.list', {}, { projectId: project.id })
      expect(asRecords(listed.sessions).map(session => session.id)).toEqual([asRecord(created.session).id])

      const got = await executeJson('core.session.get', { sessionId: asRecord(created.session).id })
      expect(asRecord(got.session).id).toBe(asRecord(created.session).id)
    } finally {
      acpHost.agents.delete(agent.id)
    }
  })


  test('legacy create_task keeps the old response shape', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    const created = await executeJson('create_task', { title: 'Legacy task' }, { projectId: project.id })

    expect(Object.keys(created).sort()).toEqual(['status', 'taskId', 'title'])
    expect(created.title).toBe('Legacy task')
    expect(created.status).toBe('backlog')
    expect(typeof created.taskId).toBe('string')
  })

  test('task tools use explicit projectId before context projectId', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    taskStore.create({ title: 'A task', source: 'human', projectId: projectA.id })

    const created = await executeJson('core.task.create', { title: 'B task', projectId: projectB.id }, { projectId: projectA.id })
    expect(asRecord(created.task).project_id).toBe(projectB.id)

    const listedA = await executeJson('core.task.list', {}, { projectId: projectA.id })
    expect(asRecords(listedA.tasks).map(task => task.title)).toEqual(['A task'])

    const listedB = await executeJson('core.task.list', { projectId: projectB.id }, { projectId: projectA.id })
    expect(asRecords(listedB.tasks).map(task => task.title)).toEqual(['B task'])
  })
})

async function executeJson(handlerName: string, input: Record<string, unknown>, context: ToolContext = {}): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
