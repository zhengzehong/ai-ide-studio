import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionTemplateStore } from '../../src/store/session-templates.js'
import { acpHost } from '../../src/acp/host.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-template-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function mockFork(returnId: string) {
  return vi.spyOn(acpHost, 'forkSessionFromAcpSessionId').mockImplementation(
    async (_agentId: string, _sourceAcpSessionId: string, targetSessionId: string) => {
      sessionStore.updateAcpSessionId(targetSessionId, returnId)
      return returnId
    },
  )
}

function mockClose() {
  return vi.spyOn(acpHost, 'closeSession').mockResolvedValue(undefined)
}

function createAgentAndSourceSession(acpSessionId = 'acp-src-1') {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const agent = agentStore.create({
    name: 'Mock',
    type: 'dev',
    runtime: 'mock',
    projectId: project.id,
  })
  const session = sessionStore.create({
    agentId: agent.id,
    projectId: project.id,
    acpSessionId,
    title: 'src session',
  })
  return { project, agent, session }
}

describe('session-template AI tool handlers', () => {
  test('list 无 filter:返回全部模板', async () => {
    const { project, agent, session } = createAgentAndSourceSession()
    const forkSpy = mockFork('acp-tpl-1')
    const closeSpy = mockClose()
    try {
      await executeJson(
        'core.session.template.publish',
        { sessionId: session.id, name: '模板A' },
        { projectId: project.id },
      )

      const agent2 = agentStore.create({
        name: 'Mock2',
        type: 'dev',
        runtime: 'mock',
        projectId: project.id,
      })
      const session2 = sessionStore.create({
        agentId: agent2.id,
        projectId: project.id,
        acpSessionId: 'acp-src-2',
        title: 'src session 2',
      })
      await executeJson(
        'core.session.template.publish',
        { sessionId: session2.id, name: '模板B' },
        { projectId: project.id },
      )

      const listed = await executeJson('core.session.template.list', {}, { projectId: project.id })
      const templates = asRecords(listed.templates)
      expect(templates).toHaveLength(2)
      expect(templates.map((t) => t.name).sort()).toEqual(['模板A', '模板B'])
    } finally {
      forkSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })

  test('list 带 agentId:只返回该 Agent 的模板', async () => {
    const { project, agent, session } = createAgentAndSourceSession()
    const forkSpy = mockFork('acp-tpl-1')
    const closeSpy = mockClose()
    try {
      await executeJson(
        'core.session.template.publish',
        { sessionId: session.id, name: '模板A' },
        { projectId: project.id },
      )

      const agent2 = agentStore.create({
        name: 'Mock2',
        type: 'dev',
        runtime: 'mock',
        projectId: project.id,
      })
      const session2 = sessionStore.create({
        agentId: agent2.id,
        projectId: project.id,
        acpSessionId: 'acp-src-2',
        title: 'src session 2',
      })
      await executeJson(
        'core.session.template.publish',
        { sessionId: session2.id, name: '模板B' },
        { projectId: project.id },
      )

      const listed = await executeJson(
        'core.session.template.list',
        { agentId: agent.id },
        { projectId: project.id },
      )
      const templates = asRecords(listed.templates)
      expect(templates).toHaveLength(1)
      expect(templates[0].name).toBe('模板A')
      expect(templates[0].agent_id).toBe(agent.id)
    } finally {
      forkSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })

  test('publish 成功:返回模板记录,字段完整', async () => {
    const { project, agent, session } = createAgentAndSourceSession()
    const forkSpy = mockFork('acp-tpl-new')
    const closeSpy = mockClose()
    try {
      const result = await executeJson(
        'core.session.template.publish',
        { sessionId: session.id, name: '我的模板', description: '描述', icon: 'bot' },
        { projectId: project.id },
      )
      const template = asRecord(result.template)
      expect(template.id.startsWith('tpl-sess-')).toBe(true)
      expect(template.name).toBe('我的模板')
      expect(template.description).toBe('描述')
      expect(template.icon).toBe('bot')
      expect(template.agent_id).toBe(agent.id)
      expect(template.project_id).toBe(project.id)
      expect(template.runtime).toBe('mock')
      expect(template.source_session_id).toBe(session.id)
      expect(template.template_session_id).toBeTruthy()
      expect(template.use_count).toBe(0)
      expect(template.last_used_at).toBeNull()

      const templateSession = sessionStore.get(template.template_session_id as string)
      expect(templateSession?.is_template).toBe(1)
    } finally {
      forkSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })

  test('publish 缺 name:报参数校验错误', async () => {
    const { project, session } = createAgentAndSourceSession()
    const handler = getHandler('core.session.template.publish')
    if (!handler) throw new Error('handler missing: core.session.template.publish')

    await expect(
      handler.execute({ sessionId: session.id }, { projectId: project.id }),
    ).rejects.toThrow('name')
  })

  test('publish 缺 sessionId:报参数校验错误', async () => {
    const { project } = createAgentAndSourceSession()
    const handler = getHandler('core.session.template.publish')
    if (!handler) throw new Error('handler missing: core.session.template.publish')

    await expect(
      handler.execute({ name: '我的模板' }, { projectId: project.id }),
    ).rejects.toThrow('sessionId')
  })

  test('instantiate 成功:返回新会话,is_template=0', async () => {
    const { project, agent, session } = createAgentAndSourceSession()
    const forkSpy = mockFork('acp-tpl-new')
    const closeSpy = mockClose()
    try {
      const published = await executeJson(
        'core.session.template.publish',
        { sessionId: session.id, name: '我的模板' },
        { projectId: project.id },
      )
      const template = asRecord(published.template)

      forkSpy.mockRestore()
      const forkSpy2 = mockFork('acp-inst-new')

      const result = await executeJson(
        'core.session.template.instantiate',
        { templateId: template.id as string },
        { projectId: project.id },
      )
      const newSession = asRecord(result.session)
      expect(newSession.id).not.toBe(template.template_session_id)
      expect(newSession.is_template).toBe(0)
      expect(newSession.agent_id).toBe(agent.id)
      expect(newSession.acp_session_id).toBe('acp-inst-new')
      expect(newSession.status).toBe('active')

      const refreshed = sessionTemplateStore.get(template.id as string)
      expect(refreshed?.use_count).toBe(1)
      expect(refreshed?.last_used_at).not.toBeNull()
      forkSpy2.mockRestore()
    } finally {
      closeSpy.mockRestore()
    }
  })

  test('instantiate 模板不存在:抛模板不存在的错误(由 Core 层 throw)', async () => {
    const { project } = createAgentAndSourceSession()
    const handler = getHandler('core.session.template.instantiate')
    if (!handler) throw new Error('handler missing: core.session.template.instantiate')

    await expect(
      handler.execute({ templateId: 'tpl-sess-not-exist' }, { projectId: project.id }),
    ).rejects.toThrow('Template not found')
  })

  test('delete 成功:返回 { success: true }', async () => {
    const { project, session } = createAgentAndSourceSession()
    const forkSpy = mockFork('acp-tpl-new')
    const closeSpy = mockClose()
    try {
      const published = await executeJson(
        'core.session.template.publish',
        { sessionId: session.id, name: '我的模板' },
        { projectId: project.id },
      )
      const template = asRecord(published.template)

      const result = await executeJson(
        'core.session.template.delete',
        { templateId: template.id as string },
        { projectId: project.id },
      )
      expect(result).toEqual({ success: true })
      expect(sessionTemplateStore.get(template.id as string)).toBeUndefined()
    } finally {
      forkSpy.mockRestore()
      closeSpy.mockRestore()
    }
  })

  test('delete 模板不存在:静默成功(Core 层 deleteTemplate 不存在静默返回)', async () => {
    const { project } = createAgentAndSourceSession()
    const result = await executeJson(
      'core.session.template.delete',
      { templateId: 'tpl-sess-not-exist' },
      { projectId: project.id },
    )
    expect(result).toEqual({ success: true })
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): Promise<Record<string, unknown>> {
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
