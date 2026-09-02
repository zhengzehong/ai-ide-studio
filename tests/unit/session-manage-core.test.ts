import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-manage-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createSession(input: { primary?: boolean; purpose?: 'conversation' | 'autonomy' } = {}) {
  const agent = agentStore.create({ type: 'dev', name: 'agent-manage', runtime: 'mock' })
  return sessionStore.create({
    agentId: agent.id,
    isPrimary: input.primary,
    purpose: input.purpose ?? 'conversation',
  })
}

function closeSessionRow(sessionId: string): void {
  sessionStore.updateStatus(sessionId, 'closed')
}

function makeSessionRunning(sessionId: string): void {
  messageStore.append(sessionId, { role: 'agent', content: '', status: 'running' })
}

function collectSessionChanged(): Array<{ sessionId: string; data: Record<string, unknown> }> {
  const received: Array<{ sessionId: string; data: Record<string, unknown> }> = []
  const listener = (msg: unknown): void => {
    const payload = msg as { sessionId: string; data: Record<string, unknown> }
    received.push({ sessionId: payload.sessionId, data: payload.data })
  }
  events.on('session:changed', listener)
  return Object.assign(received, {
    stop: () => events.off('session:changed', listener),
  })
}

describe('sessionManager archiveSession guard', () => {
  test('archives a closed conversation session and emits session:changed', () => {
    const session = createSession()
    closeSessionRow(session.id)
    const received = collectSessionChanged()
    try {
      const archived = sessionManager.archiveSession(session.id)
      expect(archived.archived_at).not.toBeNull()
      const event = received.find((item) => item.sessionId === session.id)
      expect(event?.data.event).toBe('archived')
      expect(event?.data.archived_at).not.toBeNull()
    } finally {
      received.stop()
    }
  })

  test('rejects archiving the primary session', () => {
    const session = createSession({ primary: true })
    expect(() => sessionManager.archiveSession(session.id)).toThrow('主会话不可归档')
  })

  test('rejects archiving a running session detected via DB signals', () => {
    const session = createSession()
    closeSessionRow(session.id)
    makeSessionRunning(session.id)
    expect(() => sessionManager.archiveSession(session.id)).toThrow('运行中的会话不可归档')
  })

  test('rejects archiving an already archived session (idempotent error)', () => {
    const session = createSession()
    closeSessionRow(session.id)
    sessionManager.archiveSession(session.id)
    expect(() => sessionManager.archiveSession(session.id)).toThrow('会话已归档')
  })

  test('rejects archiving system sessions', () => {
    const session = createSession({ purpose: 'autonomy' })
    expect(() => sessionManager.archiveSession(session.id)).toThrow('系统会话不可归档')
  })
})

describe('sessionManager.restoreSession guard', () => {
  test('restores an archived session and emits session:changed', () => {
    const session = createSession()
    closeSessionRow(session.id)
    sessionManager.archiveSession(session.id)
    const received = collectSessionChanged()
    try {
      const restored = sessionManager.restoreSession(session.id)
      expect(restored.archived_at).toBeNull()
      const event = received.find((item) => item.sessionId === session.id)
      expect(event?.data.event).toBe('restored')
      expect(event?.data.archived_at).toBeNull()
    } finally {
      received.stop()
    }
  })

  test('rejects restoring a session that is not archived', () => {
    const session = createSession()
    expect(() => sessionManager.restoreSession(session.id)).toThrow('会话未归档')
  })
})

describe('sessionManager.setSessionTags', () => {
  test('normalizes and persists tags, then emits the updated session', () => {
    const session = createSession()
    const received = collectSessionChanged()
    try {
      const updated = sessionManager.setSessionTags(session.id, [' 调研 ', '', '调研', 'workbench'])
      expect(updated.tags).toEqual(['调研', 'workbench'])
      expect(sessionStore.get(session.id)?.tags).toEqual(['调研', 'workbench'])
      const event = received.find((item) => item.sessionId === session.id)
      expect(event?.data.tags).toEqual(['调研', 'workbench'])
    } finally {
      received.stop()
    }
  })

  test('allows clearing all tags with an empty array', () => {
    const session = createSession()
    sessionManager.setSessionTags(session.id, ['临时'])
    const cleared = sessionManager.setSessionTags(session.id, [])
    expect(cleared.tags).toEqual([])
    expect(JSON.parse(getDb().prepare<[string], { tags_json: string }>('SELECT tags_json FROM sessions WHERE id = ?').get(session.id)?.tags_json ?? '[]')).toEqual([])
  })

  test('rejects invalid tag payloads', () => {
    const session = createSession()
    expect(() => sessionManager.setSessionTags(session.id, ['x'.repeat(25)])).toThrow('单个标签不能超过 24 个字符')
  })

  test('rejects deleted sessions', () => {
    const session = createSession()
    sessionStore.delete(session.id)
    expect(() => sessionManager.setSessionTags(session.id, ['调研'])).toThrow('会话已删除')
  })
})
