import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { SessionUpdateData } from '../../src/types/ws-protocol.js'
import { SessionUpdateBatcher, type SessionUpdateEnvelope } from '../../src/core/session-update-batcher.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'

function envelope(data: SessionUpdateData): SessionUpdateEnvelope {
  return {
    sessionId: 'sess-batch',
    agentId: 'agent-batch',
    data,
  }
}

describe('SessionUpdateBatcher', () => {
  test('merges text deltas for the same session and message before flushing', () => {
    vi.useFakeTimers()
    const applied: SessionUpdateEnvelope[] = []
    const batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })

    batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'hello ' }), (ev) => applied.push(ev))
    batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'world' }), (ev) => applied.push(ev))

    expect(applied).toEqual([])

    vi.advanceTimersByTime(100)

    expect(applied).toHaveLength(1)
    expect(applied[0].data).toMatchObject({
      messageId: 'msg-1',
      role: 'agent',
      contentDelta: 'hello world',
    })

    batcher.dispose()
    vi.useRealTimers()
  })

  test('flushes pending text before applying a critical permission request', () => {
    vi.useFakeTimers()
    const applied: SessionUpdateEnvelope[] = []
    const batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })

    batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'before permission' }), (ev) => applied.push(ev))
    batcher.handle(
      envelope({
        messageId: 'permission-1',
        role: 'system',
        permissionRequest: {
          id: 'permission-1',
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_always' }],
        },
      }),
      (ev) => applied.push(ev),
    )

    expect(applied).toHaveLength(2)
    expect(applied[0].data).toMatchObject({ messageId: 'msg-1', contentDelta: 'before permission' })
    expect(applied[1].data).toMatchObject({ messageId: 'permission-1', permissionRequest: { id: 'permission-1' } })

    batcher.dispose()
    vi.useRealTimers()
  })

  test('clears pending updates when database closes', () => {
    vi.useFakeTimers()
    const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-update-batcher-'))
    let batcher: SessionUpdateBatcher | undefined
    try {
      initDatabase(resolve(tmp, 'test.sqlite'))
      batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })
      batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'after close' }), () => {
        throw new Error('timer fired after database close')
      })

      closeDatabase()

      expect(() => vi.advanceTimersByTime(100)).not.toThrow()
    } finally {
      batcher?.dispose()
      closeDatabase()
      rmSync(tmp, { recursive: true, force: true })
      vi.useRealTimers()
    }
  })
})
