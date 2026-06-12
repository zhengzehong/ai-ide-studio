import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { globalAssistantStore } from '../../src/store/global-assistant.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-global-assistant-'))
let dbIndex = 0
const originalWorkspaceRoot = process.env.GLOBAL_ASSISTANT_WORKSPACE_ROOT

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  process.env.GLOBAL_ASSISTANT_WORKSPACE_ROOT = resolve(tmp, 'global-assistants')
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalWorkspaceRoot === undefined) delete process.env.GLOBAL_ASSISTANT_WORKSPACE_ROOT
  else process.env.GLOBAL_ASSISTANT_WORKSPACE_ROOT = originalWorkspaceRoot
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createWs() {
  const handlers = new Map<string, (raw?: unknown) => unknown>()
  const sent: string[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    send(payload: string) { sent.push(payload) },
    on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
  } as unknown as WebSocket
  handleWsConnection(ws, {} as never, {} as WebSocketServer)
  const onMessage = handlers.get('message')!
  return {
    sent,
    send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))),
    last: () => JSON.parse(sent.at(-1) || '{}') as { type: string; requestId?: string; data?: unknown; message?: string },
  }
}

describe('Global assistant RPC', () => {
  test('binds an agent template to the single global assistant session', async () => {
    const template = templateStore.create({
      name: '知识助理',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '整理知识',
      description: '随手记录和整理',
      skills: ['知识整理'],
    })
    const ws = createWs()

    await ws.send({ type: 'globalAssistant.setTemplate', requestId: 'req-set', templateId: template.id })

    const response = ws.last()
    expect(response.type).toBe('result')
    const data = response.data as {
      assistant: { id: string; agent_id: string; session_id: string; workspace_dir: string; enabled: number }
      agent: { id: string; project_id: string | null; template_id: string | null; system_prompt: string; icon: string }
      session: { id: string; agent_id: string; project_id: string | null; title: string | null }
    }
    expect(data.assistant.id).toBe('default')
    expect(data.assistant.enabled).toBe(1)
    expect(data.agent.project_id).toBeNull()
    expect(data.agent.template_id).toBe(template.id)
    expect(data.agent.system_prompt).toBe('整理知识')
    expect(data.agent.icon).toBe('bot')
    expect(data.session.agent_id).toBe(data.agent.id)
    expect(data.session.project_id).toBeNull()
    expect(data.session.title).toBe('全局助理')
    expect(data.assistant.session_id).toBe(data.session.id)
    const normalizedWorkspace = data.assistant.workspace_dir.replace(/\\/g, '/')
    expect(normalizedWorkspace).toContain(`/global-assistants/${data.agent.id}/workspace`)
    expect(normalizedWorkspace).not.toContain('/case-')
    expect(normalizedWorkspace).not.toContain(template.name)
    expect(existsSync(data.assistant.workspace_dir)).toBe(true)

    await ws.send({ type: 'globalAssistant.get', requestId: 'req-get' })
    expect(ws.last().data).toMatchObject({
      assistant: { id: 'default', session_id: data.session.id },
      agent: { id: data.agent.id },
      session: { id: data.session.id },
    })
  })

  test('uses the global assistant workspace as the ACP cwd for its session', async () => {
    const template = templateStore.create({
      name: '秘书',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '处理日程',
    })
    const ws = createWs()
    await ws.send({ type: 'globalAssistant.setTemplate', requestId: 'req-set', templateId: template.id })
    const binding = ws.last().data as { assistant: { workspace_dir: string }; session: { id: string; agent_id: string } }

    const ensureSession = vi.spyOn(acpHost, 'ensureSession').mockResolvedValue('acp-global')

    await ws.send({ type: 'session.getModels', requestId: 'req-models', sessionId: binding.session.id })

    expect(ws.last().type).toBe('result')
    expect(ensureSession).toHaveBeenCalledWith(
      binding.session.agent_id,
      binding.session.id,
      null,
      expect.objectContaining({
        cwd: binding.assistant.workspace_dir,
        emitLifecycle: false,
      }),
    )
    expect(sessionStore.get(binding.session.id)?.acp_session_id).toBe('acp-global')
    expect(agentStore.get(binding.session.agent_id)?.project_id).toBeNull()
  })

  test('uses prompt project context for global assistant tools without changing workspace cwd', async () => {
    const projectWorkDir = resolve(tmp, 'project-context')
    const project = projectStore.create({ name: '项目上下文', workDir: projectWorkDir })
    const template = templateStore.create({
      name: '项目助理',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '处理当前项目事务',
    })
    const ws = createWs()
    await ws.send({ type: 'globalAssistant.setTemplate', requestId: 'req-set', templateId: template.id })
    const binding = ws.last().data as { assistant: { workspace_dir: string }; session: { id: string; agent_id: string } }

    const ensureSession = vi.spyOn(acpHost, 'ensureSession').mockResolvedValue('acp-global')
    const prompt = vi.spyOn(acpHost, 'prompt').mockResolvedValue(undefined)

    await ws.send({
      type: 'prompt',
      requestId: 'req-prompt',
      sessionId: binding.session.id,
      content: '创建当前项目的定时任务',
      contextProjectId: project.id,
    })

    expect(ws.sent.map((item) => JSON.parse(item) as { type: string; requestId?: string; data?: unknown })).toContainEqual(
      { type: 'result', requestId: 'req-prompt', data: { status: 'streaming' } },
    )
    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalled()
    })
    expect(ensureSession).toHaveBeenCalledWith(
      binding.session.agent_id,
      binding.session.id,
      null,
      expect.objectContaining({
        projectId: project.id,
        cwd: binding.assistant.workspace_dir,
      }),
    )
    expect(sessionStore.get(binding.session.id)?.project_id).toBeNull()
  })

  test('switching global assistant templates creates a new agent-specific workspace', async () => {
    const first = templateStore.create({
      name: '知识助理',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '整理知识',
    })
    const second = templateStore.create({
      name: '文档工程师',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '维护文档',
    })
    const ws = createWs()

    await ws.send({ type: 'globalAssistant.setTemplate', requestId: 'req-first', templateId: first.id })
    const firstBinding = ws.last().data as { assistant: { workspace_dir: string }; agent: { id: string; name: string } }

    await ws.send({ type: 'globalAssistant.setTemplate', requestId: 'req-second', templateId: second.id })
    const secondBinding = ws.last().data as { assistant: { workspace_dir: string }; agent: { id: string; name: string } }

    expect(secondBinding.agent.id).not.toBe(firstBinding.agent.id)
    expect(secondBinding.assistant.workspace_dir).not.toBe(firstBinding.assistant.workspace_dir)
    expect(secondBinding.assistant.workspace_dir.replace(/\\/g, '/')).toContain(`/global-assistants/${secondBinding.agent.id}/workspace`)
    expect(secondBinding.assistant.workspace_dir).not.toContain(secondBinding.agent.name)
    expect(existsSync(secondBinding.assistant.workspace_dir)).toBe(true)
  })

  test('normalizes an existing legacy workspace to the agent-specific root', async () => {
    const agent = agentStore.create({
      name: '旧助理',
      type: 'pm',
      runtime: 'mock',
      icon: 'bot',
      systemPrompt: '整理旧数据',
    })
    const session = sessionStore.create({ agentId: agent.id })
    const now = new Date().toISOString()
    const legacyWorkspace = resolve(tmp, 'legacy-global-assistant', 'workspace')
    getDb().prepare(`
      INSERT INTO global_assistant (
        id, agent_id, session_id, workspace_dir, enabled, created_at, updated_at, last_opened_at
      )
      VALUES (
        @id, @agent_id, @session_id, @workspace_dir, @enabled, @created_at, @updated_at, @last_opened_at
      )
    `).run({
      id: 'default',
      agent_id: agent.id,
      session_id: session.id,
      workspace_dir: legacyWorkspace,
      enabled: 1,
      created_at: now,
      updated_at: now,
      last_opened_at: null,
    })
    const ws = createWs()

    await ws.send({ type: 'globalAssistant.get', requestId: 'req-get' })

    const data = ws.last().data as { assistant: { workspace_dir: string }; agent: { id: string } }
    const normalizedWorkspace = data.assistant.workspace_dir.replace(/\\/g, '/')
    expect(normalizedWorkspace).toContain(`/global-assistants/${agent.id}/workspace`)
    expect(normalizedWorkspace).not.toContain('legacy-global-assistant')
    expect(normalizedWorkspace).not.toContain(agent.name)
    expect(globalAssistantStore.get()?.workspace_dir).toBe(data.assistant.workspace_dir)
    expect(existsSync(data.assistant.workspace_dir)).toBe(true)
  })
})
