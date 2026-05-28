import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, eventStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { acpHost } from '../../src/acp/host.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-done-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('session done metadata', () => {
  test('message.done event persists stopReason and error', () => {
    const session = sessionStore.create({ agentId: 'agent-done' })
    events.emit('session:done', { sessionId: session.id, agentId: 'agent-done', messageId: 'msg-error', stopReason: 'error', error: 'boom' })

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
})
