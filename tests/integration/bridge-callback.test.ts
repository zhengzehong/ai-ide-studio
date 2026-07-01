import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import { startGateway } from '../../src/gateway/server.js'
import type { AppConfig } from '../../src/core/config.js'
import type { Server } from 'node:http'
import type { WebSocketServer } from 'ws'

type GatewayHandle = Awaited<ReturnType<typeof startGateway>>

let tmp: string
let server: Server | undefined
let wss: WebSocketServer | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-bridge-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(async () => {
  await closeGateway()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

afterAll(() => {
  // noop, tmp cleaned per-test
})

async function startTestGateway(config: Partial<AppConfig>): Promise<void> {
  const handle: GatewayHandle = await startGateway({
    port: 0,
    dataDir: tmp,
    ...config,
  })
  server = handle.server
  wss = handle.wss
}

async function closeGateway(): Promise<void> {
  if (wss) {
    wss.close()
    wss = undefined
  }
  if (server) {
    await new Promise<void>((resolveClose) => server?.close(() => resolveClose()))
    server = undefined
  }
}

function baseUrl(): string {
  const address = server?.address()
  if (!address || typeof address === 'string') throw new Error('test server not listening')
  return `http://127.0.0.1:${address.port}`
}

function createSession(): { sessionId: string; agentId: string } {
  const agent = agentStore.create({ name: 'Bridge Agent', type: 'dev', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id })
  return { sessionId: session.id, agentId: agent.id }
}

describe('POST /api/bridge/callback', () => {
  test('rejects callback without matching X-Callback-Token when configured', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'wrong' },
      body: JSON.stringify({ event: 'message.received', messageId: 'm1', content: { type: 'text', text: 'hi' }, extra: { sessionId: 'sess-x' } }),
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid callback token' })
  })

  test('returns 400 when extra.sessionId is missing', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'secret-tok' },
      body: JSON.stringify({ event: 'message.received', messageId: 'm2', content: { type: 'text', text: 'hi' } }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'missing extra.sessionId' })
  })

  test('returns 404 when session does not exist', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'secret-tok' },
      body: JSON.stringify({ event: 'message.received', messageId: 'm3', content: { type: 'text', text: 'hi' }, extra: { sessionId: 'sess-missing' } }),
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('session not found')
  })

  test('returns 400 on invalid json body', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'secret-tok' },
      body: 'not-json',
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid json' })
  })

  test('skips non message.received events with ok response', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })
    const { sessionId } = createSession()

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'secret-tok' },
      body: JSON.stringify({ event: 'agent.registered', messageId: 'm4', content: { type: 'text', text: 'hi' }, extra: { sessionId } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, skipped: true })
  })

  test('accepts callback without token when bridgeCallbackToken is not configured', async () => {
    await startTestGateway({})
    const { sessionId } = createSession()

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'message.received', messageId: 'm5', content: { type: 'text', text: 'hi' }, extra: { sessionId } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, sessionId })
  })

  test('enqueues prompt into target session on valid callback', async () => {
    await startTestGateway({ bridgeCallbackToken: 'secret-tok' })
    const { sessionId, agentId } = createSession()

    let activityReceived = false
    const handler = (ev: { sessionId?: string; state?: string }): void => {
      if (ev.sessionId === sessionId && ev.state === 'running') activityReceived = true
    }
    events.on('session:activity', handler)

    try {
      const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'secret-tok' },
        body: JSON.stringify({
          event: 'message.received',
          messageId: 'm6',
          fromAgentId: 'agent-a',
          fromAgentName: 'Agent-A',
          conversationId: 'conv-1',
          timestamp: Date.now(),
          content: { type: 'text', text: 'hello from bridge' },
          extra: { sessionId },
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, messageId: 'm6', sessionId })

      for (let i = 0; i < 40 && !activityReceived; i++) {
        await new Promise((r) => setTimeout(r, 25))
      }
      expect(activityReceived).toBe(true)
    } finally {
      events.off('session:activity', handler)
    }
    expect(agentId).toBeTruthy()
  })

  test('bypasses x-ai-ide-token local guard for /api/bridge/ path', async () => {
    await startTestGateway({ localToken: 'local-secret', bridgeCallbackToken: 'bridge-tok' })
    const { sessionId } = createSession()

    const res = await fetch(`${baseUrl()}/api/bridge/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Callback-Token': 'bridge-tok' },
      body: JSON.stringify({ event: 'message.received', messageId: 'm7', content: { type: 'text', text: 'hi' }, extra: { sessionId } }),
    })

    expect(res.status).toBe(200)
  })
})
