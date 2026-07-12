import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionShareStore } from '../../src/store/session-shares.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { subscriptionRpcHandlers } from '../../src/gateway/rpc/subscriptions.js'
import type { RpcClientState, RpcContext } from '../../src/gateway/rpc/types.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-guest-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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

function createAgent(): string {
  const agent = agentStore.create({ type: 'dev', name: 'tester', runtime: 'mock' })
  return agent.id
}

function createSession(agentId: string): string {
  const session = sessionStore.create({ agentId, title: 'test session' })
  return session.id
}

function makeGuestContext(shareToken: string, sessionId?: string): { state: RpcClientState; ctx: RpcContext; results: unknown[]; errors: string[] } {
  const results: unknown[] = []
  const errors: string[] = []
  const state: RpcClientState = {
    subscriptions: new Set(),
    authMode: 'guest',
    shareToken,
    guestId: 'guest-test',
    guestName: 'Test Guest',
    sessionId,
  }
  const ctx: RpcContext = {
    state,
    sendResult: (data) => { results.push(data) },
    sendError: (msg) => { errors.push(msg) },
    sendOutOfBandError: (msg) => { errors.push(msg) },
  }
  return { state, ctx, results, errors }
}

describe('guest_prompt RPC', () => {
  let dir: string
  let agentId: string
  let sessionId: string

  beforeEach(() => {
    dir = setupTestDb()
    agentId = createAgent()
    sessionId = createSession(agentId)
  })

  afterEach(() => {
    teardownTestDb(dir)
  })

  it('readonly permission 拒绝', async () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 'readonly share',
      agentIntro: 'i',
      permission: 'readonly',
    })
    const { ctx, errors, results } = makeGuestContext(share.share_token, sessionId)
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: 'hello' } as never,
      ctx,
    )
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('只读')
    expect(results.length).toBe(0)
  })

  it('expired share 拒绝', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 'expired',
      agentIntro: 'i',
      permission: 'chat',
      expiresAt: past,
    })
    const { ctx, errors } = makeGuestContext(share.share_token, sessionId)
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: 'hello' } as never,
      ctx,
    )
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('过期')
  })

  it('session 不匹配拒绝', async () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      permission: 'chat',
    })
    // state.sessionId 设成另一个 session
    const { ctx, errors } = makeGuestContext(share.share_token, 'sess-other')
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: 'hello' } as never,
      ctx,
    )
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('不匹配')
  })

  it('空内容拒绝', async () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      permission: 'chat',
    })
    const { ctx, errors } = makeGuestContext(share.share_token, sessionId)
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: '   ' } as never,
      ctx,
    )
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('空')
  })

  it('正常 enqueuePrompt 并订阅会话', async () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      permission: 'chat',
    })
    const { state, ctx, results } = makeGuestContext(share.share_token, sessionId)
    // mock sessionManager.enqueuePrompt 通过 spy 模块顶层 import
    const { sessionManager } = await import('../../src/core/sessions.js')
    const spy = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined as never)
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: 'hi agent' } as never,
      ctx,
    )
    expect(results.length).toBe(1)
    expect((results[0] as { status: string }).status).toBe('streaming')
    expect(state.subscriptions.has(sessionId)).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toBe(sessionId)
    expect(spy.mock.calls[0]?.[1]).toBe('hi agent')
    // 第 3 个参数是 images(undefined),第 4 个才是 options
    const opts = spy.mock.calls[0]?.[3] as { senderRole: string; senderId: string; senderName: string }
    expect(opts.senderRole).toBe('guest')
    expect(opts.senderId).toBe('guest-test')
    expect(opts.senderName).toBe('Test Guest')
    spy.mockRestore()
  })

  it('非 guest 身份拒绝', async () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      permission: 'chat',
    })
    const errors: string[] = []
    const ctx: RpcContext = {
      state: { subscriptions: new Set(), authMode: 'owner' },
      sendResult: () => {},
      sendError: (m) => { errors.push(m) },
      sendOutOfBandError: (m) => { errors.push(m) },
    }
    await subscriptionRpcHandlers.guest_prompt!(
      { type: 'guest_prompt', shareToken: share.share_token, content: 'hi' } as never,
      ctx,
    )
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain('访客')
  })
})
