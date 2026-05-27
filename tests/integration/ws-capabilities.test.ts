import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { acpHost } from '../../src/acp/host.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-ws-cap-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('session.getModels WS RPC', () => {
  test('返回完整的会话能力信息', async () => {
    agentStore.upsert({ id: 'agent-cap', type: 'dev', name: '能力测试', runtime: 'mock' })
    const session = sessionStore.create({ agentId: 'agent-cap' })

    const capabilities = {
      models: [{ modelId: 'm-1', name: '模型一' }],
      currentModelId: 'm-1',
      modes: [{ modeId: 'plan', name: '计划模式' }],
      currentModeId: 'plan',
      supportsImages: true,
      supportsAudio: true,
      configOptions: [{ id: 'effort', name: '思考强度', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: '高' }] }],
      commands: [{ name: 'review', description: '代码审查', input: { hint: '输入审查范围' } }],
      sessionInfo: { title: '能力会话', updatedAt: '2026-05-27T00:00:00.000Z' },
    }

    const original = acpHost.getSessionCapabilities
    acpHost.getSessionCapabilities = (() => capabilities) as typeof acpHost.getSessionCapabilities

    const handlers = new Map<string, (raw?: unknown) => unknown>()
    const sent: string[] = []
    const ws = {
      OPEN: 1, readyState: 1,
      send(payload: string) { sent.push(payload) },
      on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
    } as unknown as WebSocket

    handleWsConnection(ws, {} as never, {} as WebSocketServer)
    const onMessage = handlers.get('message')!
    await Promise.resolve(onMessage(Buffer.from(JSON.stringify({ type: 'session.getModels', requestId: 'req-1', sessionId: session.id }))))

    const response = JSON.parse(sent.at(-1) || '{}')
    expect(response.type).toBe('result')
    expect(response.requestId).toBe('req-1')
    expect(response.data.supportsAudio).toBe(true)
    expect(response.data.configOptions[0].id).toBe('effort')
    expect(response.data.commands[0].name).toBe('review')
    expect(response.data.sessionInfo.title).toBe('能力会话')

    acpHost.getSessionCapabilities = original
  })
})
