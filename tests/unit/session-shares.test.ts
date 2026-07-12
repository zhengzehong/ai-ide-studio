import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, getDb, closeDatabase } from '../../src/store/db.js'
import { sessionShareStore, generateShareToken } from '../../src/store/session-shares.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'

function setupTestDb(): string {
  const dir = join(tmpdir(), `ai-ide-session-shares-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
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
  const agent = agentStore.create({
    type: 'test',
    name: 'tester',
    runtime: 'claude',
  })
  return agent.id
}

function createSession(agentId: string): string {
  const session = sessionStore.create({ agentId, title: 'test session' })
  return session.id
}

describe('sessionShareStore', () => {
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

  it('generateShareToken generates 32-char alphanumeric token', () => {
    const token = generateShareToken()
    expect(token.length).toBe(32)
    expect(/^[A-Za-z0-9]+$/.test(token)).toBe(true)
  })

  it('create persists share with defaults', () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 'test share',
      agentIntro: 'intro',
    })
    expect(share.id.startsWith('shr-')).toBe(true)
    expect(share.share_token.length).toBe(32)
    expect(share.permission).toBe('chat')
    expect(share.tool_call_visibility).toBe('collapse')
    expect(share.expires_at).toBeNull()
    expect(share.revoked_at).toBeNull()
    expect(share.deleted_at).toBeNull()
    expect(share.visit_count).toBe(0)
  })

  it('getByToken returns only non-revoked, non-deleted shares', () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
    })
    expect(sessionShareStore.getByToken(share.share_token)?.id).toBe(share.id)

    sessionShareStore.revoke(share.id)
    expect(sessionShareStore.getByToken(share.share_token)).toBeUndefined()

    const share2 = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's2',
      agentIntro: 'i',
    })
    sessionShareStore.softDelete(share2.id)
    expect(sessionShareStore.getByToken(share2.share_token)).toBeUndefined()
  })

  it('incrementVisit bumps count and timestamp', () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
    })
    sessionShareStore.incrementVisit(share.share_token)
    sessionShareStore.incrementVisit(share.share_token)
    const updated = sessionShareStore.getById(share.id)
    expect(updated?.visit_count).toBe(2)
    expect(updated?.last_visited_at).toBeTruthy()
  })

  it('isEffective returns false for expired shares', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      expiresAt: past,
    })
    expect(sessionShareStore.isEffective(share.share_token)).toBe(false)
  })

  it('isEffective returns true for valid share', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
      expiresAt: future,
    })
    expect(sessionShareStore.isEffective(share.share_token)).toBe(true)
  })

  it('listByOwner returns only owner shares', () => {
    const share1 = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's1',
      agentIntro: 'i',
    })
    const share2 = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's2',
      agentIntro: 'i',
    })
    const list = sessionShareStore.listByOwner(agentId)
    expect(list.length).toBe(2)
    const ids = list.map((s) => s.id)
    expect(ids).toContain(share1.id)
    expect(ids).toContain(share2.id)
  })

  it('renew clears revoked_at and sets new expires_at', () => {
    const share = sessionShareStore.create({
      sessionId,
      agentId,
      ownerAgentId: agentId,
      shareName: 's',
      agentIntro: 'i',
    })
    sessionShareStore.revoke(share.id)
    expect(sessionShareStore.getById(share.id)?.revoked_at).toBeTruthy()

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    sessionShareStore.renew(share.id, future)
    const renewed = sessionShareStore.getById(share.id)
    expect(renewed?.revoked_at).toBeNull()
    expect(renewed?.expires_at).toBe(future)
  })

  it('softDeleteBySession cascades all shares for a session', () => {
    sessionShareStore.create({ sessionId, agentId, ownerAgentId: agentId, shareName: 'a', agentIntro: 'i' })
    sessionShareStore.create({ sessionId, agentId, ownerAgentId: agentId, shareName: 'b', agentIntro: 'i' })
    const count = sessionShareStore.softDeleteBySession(sessionId)
    expect(count).toBe(2)
    expect(sessionShareStore.listByOwner(agentId).length).toBe(0)
  })
})

describe('messageStore sender fields', () => {
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

  it('appends message with sender_id/sender_name/sender_role', () => {
    const msg = messageStore.append(sessionId, {
      role: 'human',
      content: 'hello',
      senderId: 'guest-abc',
      senderName: '访客',
      senderRole: 'guest',
    })
    expect(msg.sender_id).toBe('guest-abc')
    expect(msg.sender_name).toBe('访客')
    expect(msg.sender_role).toBe('guest')

    const fetched = messageStore.get(msg.id)
    expect(fetched?.sender_id).toBe('guest-abc')
    expect(fetched?.sender_name).toBe('访客')
    expect(fetched?.sender_role).toBe('guest')
  })

  it('defaults sender_role based on role when not provided', () => {
    const humanMsg = messageStore.append(sessionId, { role: 'human', content: 'hi' })
    expect(humanMsg.sender_role).toBe('user')

    const agentMsg = messageStore.append(sessionId, { role: 'agent', content: 'response' })
    expect(agentMsg.sender_role).toBe('assistant')
  })
})

describe('messages table sender columns', () => {
  it('has sender_id, sender_name, sender_role columns after migration 040', () => {
    const dir = setupTestDb()
    try {
      const columns = getDb().prepare<[], { name: string }>('PRAGMA table_info(messages)').all().map((r) => r.name)
      expect(columns).toContain('sender_id')
      expect(columns).toContain('sender_name')
      expect(columns).toContain('sender_role')
    } finally {
      teardownTestDb(dir)
    }
  })
})
