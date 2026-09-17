import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { recoverMessageDraftFromEvents } from '../../src/core/message-recovery.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-message-recovery-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('recoverMessageDraftFromEvents', () => {
  test('merges message.chunk deltas by sequence (read-only)', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const messageId = 'msg-turn-zombie'

    for (const delta of ['第一段,', '第二段,', '第三段。']) {
      eventStore.append(session.id, {
        type: 'message.chunk',
        agentId: agent.id,
        messageId,
        role: 'agent',
        payload: { messageId, role: 'agent', contentDelta: delta },
      })
    }

    const recovered = recoverMessageDraftFromEvents(session.id, messageId)
    expect(recovered).not.toBeNull()
    expect(recovered?.content).toBe('第一段,第二段,第三段。')
    expect(recovered?.chunkCount).toBe(3)
    expect(recovered?.lastChunkAt).toBeTruthy()
  })

  test('falls back to snapshot content when a chunk has no delta', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const messageId = 'msg-turn-snapshot'

    eventStore.append(session.id, {
      type: 'message.chunk',
      agentId: agent.id,
      messageId,
      role: 'agent',
      payload: { messageId, role: 'agent', content: '完整快照' },
    })

    expect(recoverMessageDraftFromEvents(session.id, messageId)?.content).toBe('完整快照')
  })

  test('ignores other messages and returns null when the message has no chunks', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    eventStore.append(session.id, {
      type: 'message.chunk',
      agentId: agent.id,
      messageId: 'msg-other',
      role: 'agent',
      payload: { messageId: 'msg-other', role: 'agent', contentDelta: '别人的内容' },
    })

    expect(recoverMessageDraftFromEvents(session.id, 'msg-missing')).toBeNull()
    expect(recoverMessageDraftFromEvents(session.id, 'msg-other')?.content).toBe('别人的内容')
  })
})
