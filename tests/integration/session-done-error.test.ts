import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, messageStore, eventStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { acpHost } from '../../src/acp/host.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-done-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('session done metadata', () => {
  test('message.done event persists stopReason and error', async () => {
    const session = sessionStore.create({ agentId: 'agent-done' })
    events.emit('session:done', { sessionId: session.id, agentId: 'agent-done', messageId: 'msg-error', stopReason: 'error', error: 'boom' })
    await sessionManager.waitForPersistence(session.id)

    const done = eventStore.list(session.id).find(ev => ev.type === 'message.done')
    expect(done).toBeTruthy()
    expect(JSON.parse(done?.payload_json || '{}')).toMatchObject({ messageId: 'msg-error', stopReason: 'error', error: 'boom' })
  })

  test('sendPrompt emits error final state when ACP prompt fails', async () => {
    agentStore.upsert({ id: 'agent-prompt-fail', type: 'dev', name: 'Prompt Fail', runtime: 'mock' })
    const session = sessionStore.create({ agentId: 'agent-prompt-fail', acpSessionId: 'acp-fail' })

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-fail') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => { throw new Error('adapter failed') }) as typeof acpHost.prompt

    try {
      await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('adapter failed')
      const done = eventStore.list(session.id).find(ev => ev.type === 'message.done' && JSON.parse(ev.payload_json).stopReason === 'error')
      expect(done).toBeTruthy()
      expect(JSON.parse(done?.payload_json || '{}').error).toBe('adapter failed')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })

  test('persists the streamed assistant message id when the turn is done', async () => {
    const session = sessionStore.create({ agentId: 'agent-done-id' })

    events.emit('session:update', {
      sessionId: session.id,
      agentId: 'agent-done-id',
      data: { messageId: 'msg-live-turn-1', role: 'agent', contentDelta: 'hello' },
    })
    events.emit('session:done', {
      sessionId: session.id,
      agentId: 'agent-done-id',
      messageId: `done-${session.id}`,
      stopReason: 'end_turn',
    })
    await sessionManager.waitForPersistence(session.id)

    const agentMessage = messageStore.list(session.id, { includeToolCalls: true }).find((message) => message.role === 'agent')
    expect(agentMessage?.id).toBe('msg-live-turn-1')
    expect(agentMessage?.content).toBe('hello')
  })

  test('does not overwrite a completed message with a later error terminal', async () => {
    const session = sessionStore.create({ agentId: 'agent-terminal-cas' })
    events.emit('session:update', {
      sessionId: session.id,
      agentId: session.agent_id,
      data: { messageId: 'msg-terminal-cas', role: 'agent', contentDelta: 'completed answer' },
    })
    events.emit('session:done', {
      sessionId: session.id,
      agentId: session.agent_id,
      messageId: 'msg-terminal-cas',
      stopReason: 'end_turn',
    })
    await sessionManager.waitForPersistence(session.id)

    events.emit('session:done', {
      sessionId: session.id,
      agentId: session.agent_id,
      messageId: 'msg-terminal-cas',
      stopReason: 'error',
      error: 'late persistence failure',
    })
    await sessionManager.waitForPersistence(session.id)

    expect(messageStore.get('msg-terminal-cas')).toMatchObject({
      content: 'completed answer',
      status: 'completed',
    })
  })

  test('treats a prompt as successful when it throws after completing its message', async () => {
    agentStore.upsert({ id: 'agent-late-prompt-error', type: 'dev', name: 'Late Prompt Error', runtime: 'mock' })
    const session = sessionStore.create({ agentId: 'agent-late-prompt-error', acpSessionId: 'acp-late-prompt-error' })

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-late-prompt-error') as typeof acpHost.ensureSession
    acpHost.prompt = (async (agentId, ourSessionId, _content, _images, diagnostics) => {
      const messageId = diagnostics.messageId ?? 'missing-message-id'
      events.emit('session:update', {
        sessionId: ourSessionId,
        agentId,
        data: { messageId, role: 'agent', contentDelta: 'answer survived' },
      })
      events.emit('session:done', {
        sessionId: ourSessionId,
        agentId,
        messageId,
        turnId: diagnostics.turnId,
        stopReason: 'end_turn',
      })
      throw new Error('late persistence-like failure')
    }) as typeof acpHost.prompt

    try {
      await expect(sessionManager.sendPrompt(session.id, 'hello')).resolves.toBeUndefined()
      const agentMessage = messageStore.list(session.id, { includeToolCalls: true })
        .find((message) => message.role === 'agent')
      expect(agentMessage).toMatchObject({ content: 'answer survived', status: 'completed' })
      const doneEvents = eventStore.list(session.id).filter((event) => event.type === 'message.done')
      expect(doneEvents).toHaveLength(1)
      expect(JSON.parse(doneEvents[0].payload_json)).toMatchObject({ stopReason: 'end_turn' })
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })

  test('sendPrompt appends a visible agent error message when ACP fails before output', async () => {
    agentStore.upsert({ id: 'agent-prompt-visible-fail', type: 'dev', name: 'Visible Prompt Fail', runtime: 'mock' })
    const session = sessionStore.create({ agentId: 'agent-prompt-visible-fail', acpSessionId: 'acp-visible-fail' })

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-visible-fail') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => { throw new Error('adapter visible failed') }) as typeof acpHost.prompt

    try {
      await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('adapter visible failed')
      const messages = messageStore.list(session.id, { includeToolCalls: true })
      const agentMessage = messages.find((message) => message.role === 'agent')

      expect(agentMessage).toBeTruthy()
      const done = eventStore.list(session.id).find((event) => event.type === 'message.done' && JSON.parse(event.payload_json).stopReason === 'error')
      expect(agentMessage?.id).toBe(done?.message_id)
      expect(agentMessage?.content).toContain('adapter visible failed')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })
})
