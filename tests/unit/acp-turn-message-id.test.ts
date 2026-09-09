import { describe, expect, test, afterEach } from 'vitest'
import { createClientHandler, endClientTurn, startClientTurn } from '../../src/acp/client-handler.ts'
import { agentConnections } from '../../src/acp/host-state.ts'
import { events, flushSessionUpdates, type AppEvents } from '../../src/core/events.ts'

const agentId = 'agent-turn-message-id-test'
const acpSessionId = 'acp-session-1'
const ourSessionId = 'sess-1'

function installConnection(): void {
  agentConnections.set(agentId, {
    agentId,
    runtime: 'mock',
    proc: { kill: () => undefined },
    connection: {},
    acpSessions: new Map([[ourSessionId, acpSessionId]]),
    runtimeSessions: new Map(),
    sessionCapabilities: new Map(),
    state: 'running',
    lastUsedAt: Date.now(),
    activeTurnCount: 0,
  } as never)
}

describe('ACP client turn message ids', () => {
  test('normalizes heartbeat progress in the legacy ACP host without reviving completed tools', async () => {
    installConnection()
    const handler = createClientHandler(agentId)
    const updates: AppEvents['session:update'][] = []
    const onUpdate = (ev: AppEvents['session:update']): void => { updates.push(ev) }
    events.on('session:update', onUpdate)
    try {
      startClientTurn(agentId, acpSessionId)
      await handler.sessionUpdate({ sessionId: acpSessionId, update: {
        sessionUpdate: 'tool_call', toolCallId: 'call-real', title: 'pnpm dist', status: 'pending',
      } })
      const beat = { sessionUpdate: 'tool_call_update' as const, toolCallId: 'call-real-heartbeat-0',
        status: 'in_progress' as const, _meta: { claudeCode: { toolName: 'Bash', toolResponse: { elapsedTimeSeconds: 30 } } } }
      await handler.sessionUpdate({ sessionId: acpSessionId, update: beat })
      flushSessionUpdates(ourSessionId)
      expect(updates.at(-1)?.data.toolCallUpdate).toMatchObject({ id: 'call-real', title: 'pnpm dist', status: 'in_progress' })
      await handler.sessionUpdate({ sessionId: acpSessionId, update: {
        sessionUpdate: 'tool_call_update', toolCallId: 'call-real', status: 'completed',
      } })
      flushSessionUpdates(ourSessionId)
      const count = updates.length
      await handler.sessionUpdate({ sessionId: acpSessionId, update: beat })
      flushSessionUpdates(ourSessionId)
      expect(updates).toHaveLength(count)
    } finally {
      events.off('session:update', onUpdate)
      endClientTurn(agentId, acpSessionId)
    }
  })

  afterEach(() => {
    agentConnections.delete(agentId)
  })

  test('creates a new generated message id for each prompt turn when runtime omits messageId', async () => {
    installConnection()
    const handler = createClientHandler(agentId)
    const messageIds: string[] = []
    const onUpdate = (ev: AppEvents['session:update']) => {
      if (ev.sessionId !== ourSessionId) return
      if (ev.data.contentDelta) messageIds.push(ev.data.messageId)
    }
    events.on('session:update', onUpdate)

    try {
      startClientTurn(agentId, acpSessionId)
      await handler.sessionUpdate({
        sessionId: acpSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'first' },
        },
      } as never)
      endClientTurn(agentId, acpSessionId)

      startClientTurn(agentId, acpSessionId)
      await handler.sessionUpdate({
        sessionId: acpSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'second' },
        },
      } as never)
      endClientTurn(agentId, acpSessionId)

      flushSessionUpdates(ourSessionId)
    } finally {
      events.off('session:update', onUpdate)
      endClientTurn(agentId, acpSessionId)
    }

    expect(messageIds).toHaveLength(2)
    expect(messageIds[0]).not.toBe(messageIds[1])
  })

  test('keeps platform turn ids unique even when runtime reuses chunk messageId', async () => {
    installConnection()
    const handler = createClientHandler(agentId)
    const messageIds: string[] = []
    const onUpdate = (ev: AppEvents['session:update']) => {
      if (ev.sessionId !== ourSessionId) return
      if (ev.data.contentDelta) messageIds.push(ev.data.messageId)
    }
    events.on('session:update', onUpdate)

    try {
      startClientTurn(agentId, acpSessionId)
      await handler.sessionUpdate({
        sessionId: acpSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'runtime-reused-message',
          content: { type: 'text', text: 'first' },
        },
      } as never)
      endClientTurn(agentId, acpSessionId)

      startClientTurn(agentId, acpSessionId)
      await handler.sessionUpdate({
        sessionId: acpSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'runtime-reused-message',
          content: { type: 'text', text: 'second' },
        },
      } as never)
      endClientTurn(agentId, acpSessionId)

      flushSessionUpdates(ourSessionId)
    } finally {
      events.off('session:update', onUpdate)
      endClientTurn(agentId, acpSessionId)
    }

    expect(messageIds).toHaveLength(2)
    expect(messageIds[0]).not.toBe('runtime-reused-message')
    expect(messageIds[0]).not.toBe(messageIds[1])
  })

})
