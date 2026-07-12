import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionShareStore } from '../../src/store/session-shares.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import {
  broadcastToSubscribers,
  buildPayloadForState,
  __registerClientForTest,
  __shouldHideToolCallForState,
} from '../../src/gateway/ws-handler.js'
import type { WebSocket } from 'ws'
import type { RpcClientState } from '../../src/gateway/rpc/types.js'
import type { ServerMessage } from '../../src/types/ws-protocol.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-ws-guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'test.db')
  closeDatabase()
  initDatabase(dbPath)
  return dir
}

function teardownTestDb(dir: string): void {
  closeDatabase()
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

function makeFakeWebSocket(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = []
  const ws = {
    OPEN: 1,
    readyState: 1, // OPEN
    send: (data: string) => { sent.push(data) },
  } as unknown as WebSocket
  return { ws, sent }
}

function makeOwnerState(sessionId: string): RpcClientState {
  return { subscriptions: new Set([sessionId]), authMode: 'owner' }
}

function makeGuestState(shareToken: string, sessionId: string): RpcClientState {
  return {
    subscriptions: new Set([sessionId]),
    authMode: 'guest',
    shareToken,
    sessionId,
  }
}

function makeToolCallUpdate(sessionId: string, agentId: string): ServerMessage {
  return {
    type: 'session:update',
    sessionId,
    agentId,
    data: {
      messageId: 'msg-1',
      role: 'agent',
      toolCall: { id: 'tc-1', name: 'read', status: 'in_progress' },
      toolCallUpdate: { id: 'tc-2', name: 'write', status: 'completed' },
      contentDelta: 'thinking...',
    },
  } as unknown as ServerMessage
}

describe('ws-handler guest tool_call 过滤', () => {
  let dir: string
  let agentId: string
  let sessionId: string

  beforeEach(() => {
    dir = setupTestDb()
    agentId = agentStore.create({ type: 'dev', name: 'tester', runtime: 'mock' }).id
    sessionId = sessionStore.create({ agentId, title: 'test' }).id
  })

  afterEach(() => {
    teardownTestDb(dir)
  })

  function createShare(visibility: 'hide' | 'collapse' | 'expand') {
    return sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      permission: 'chat',
      toolCallVisibility: visibility,
    })
  }

  it('guest + hide: buildPayloadForState 过滤掉 toolCall/toolCallUpdate', () => {
    const share = createShare('hide')
    const state = makeGuestState(share.share_token, sessionId)
    const msg = makeToolCallUpdate(sessionId, agentId)
    const payload = buildPayloadForState(msg, state, sessionId)
    const parsed = JSON.parse(payload)
    expect(parsed.data.toolCall).toBeUndefined()
    expect(parsed.data.toolCallUpdate).toBeUndefined()
    // contentDelta 应保留
    expect(parsed.data.contentDelta).toBe('thinking...')
  })

  it('guest + collapse: buildPayloadForState 不过滤(保留 toolCall)', () => {
    const share = createShare('collapse')
    const state = makeGuestState(share.share_token, sessionId)
    const msg = makeToolCallUpdate(sessionId, agentId)
    const payload = buildPayloadForState(msg, state, sessionId)
    const parsed = JSON.parse(payload)
    expect(parsed.data.toolCall).toBeDefined()
    expect(parsed.data.toolCallUpdate).toBeDefined()
  })

  it('owner: buildPayloadForState 不过滤(保留 toolCall)', () => {
    createShare('hide') // 即使存在 hide 的 share,owner 也不应被过滤
    const state = makeOwnerState(sessionId)
    const msg = makeToolCallUpdate(sessionId, agentId)
    const payload = buildPayloadForState(msg, state, sessionId)
    const parsed = JSON.parse(payload)
    expect(parsed.data.toolCall).toBeDefined()
    expect(parsed.data.toolCallUpdate).toBeDefined()
  })

  it('__shouldHideToolCallForState: guest+hide 返回 true,guest+collapse 返回 false,owner 返回 false', () => {
    const hideShare = createShare('hide')
    const collapseShare = createShare('collapse')
    const guestHide = makeGuestState(hideShare.share_token, sessionId)
    const guestCollapse = makeGuestState(collapseShare.share_token, sessionId)
    const owner = makeOwnerState(sessionId)
    expect(__shouldHideToolCallForState(guestHide, sessionId)).toBe(true)
    expect(__shouldHideToolCallForState(guestCollapse, sessionId)).toBe(false)
    expect(__shouldHideToolCallForState(owner, sessionId)).toBe(false)
  })

  it('broadcastToSubscribers: guest+hide 订阅者收到过滤后 payload,owner 订阅者收到原 payload', () => {
    const share = createShare('hide')
    const { ws: wsGuest, sent: guestSent } = makeFakeWebSocket()
    const { ws: wsOwner, sent: ownerSent } = makeFakeWebSocket()
    const guestState = makeGuestState(share.share_token, sessionId)
    const ownerState = makeOwnerState(sessionId)
    const unregGuest = __registerClientForTest(wsGuest, guestState)
    const unregOwner = __registerClientForTest(wsOwner, ownerState)
    try {
      broadcastToSubscribers(sessionId, makeToolCallUpdate(sessionId, agentId))
      // guest 收到的 payload 应不含 toolCall
      expect(guestSent.length).toBe(1)
      const guestPayload = JSON.parse(guestSent[0]!)
      expect(guestPayload.data.toolCall).toBeUndefined()
      expect(guestPayload.data.toolCallUpdate).toBeUndefined()
      expect(guestPayload.data.contentDelta).toBe('thinking...')
      // owner 收到的 payload 应保留 toolCall
      expect(ownerSent.length).toBe(1)
      const ownerPayload = JSON.parse(ownerSent[0]!)
      expect(ownerPayload.data.toolCall).toBeDefined()
      expect(ownerPayload.data.toolCallUpdate).toBeDefined()
    } finally {
      unregGuest()
      unregOwner()
    }
  })

  it('broadcastToSubscribers: guest+collapse 订阅者保留 toolCall', () => {
    const share = createShare('collapse')
    const { ws: wsGuest, sent: guestSent } = makeFakeWebSocket()
    const guestState = makeGuestState(share.share_token, sessionId)
    const unreg = __registerClientForTest(wsGuest, guestState)
    try {
      broadcastToSubscribers(sessionId, makeToolCallUpdate(sessionId, agentId))
      expect(guestSent.length).toBe(1)
      const payload = JSON.parse(guestSent[0]!)
      expect(payload.data.toolCall).toBeDefined()
      expect(payload.data.toolCallUpdate).toBeDefined()
    } finally {
      unreg()
    }
  })

  it('guest+hide 但 sessionId 不匹配:不过滤', () => {
    const share = createShare('hide')
    const state = makeGuestState(share.share_token, sessionId)
    // 不匹配的 sessionId
    const otherSessionId = 'sess-other'
    const msg = makeToolCallUpdate(otherSessionId, agentId)
    const payload = buildPayloadForState(msg, state, otherSessionId)
    const parsed = JSON.parse(payload)
    // sessionId 不匹配,不应过滤
    expect(parsed.data.toolCall).toBeDefined()
  })
})
