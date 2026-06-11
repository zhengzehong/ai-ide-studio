import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-global-assistant-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
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
    expect(data.assistant.workspace_dir.replace(/\\/g, '/')).toContain('/global-assistant/workspace')
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
})
