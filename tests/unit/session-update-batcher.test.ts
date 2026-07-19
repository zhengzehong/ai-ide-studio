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
  test('merges text deltas for the same session and message before flushing', async () => {
    vi.useFakeTimers()
    const applied: SessionUpdateEnvelope[] = []
    const batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })

    batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'hello ' }), (ev) => applied.push(ev))
    batcher.handle(envelope({ messageId: 'msg-1', role: 'agent', contentDelta: 'world' }), (ev) => applied.push(ev))

    expect(applied).toEqual([])

    vi.advanceTimersByTime(100)
    await batcher.flushSession('sess-batch', (ev) => { applied.push(ev) })

    expect(applied).toHaveLength(1)
    expect(applied[0].data).toMatchObject({
      messageId: 'msg-1',
      role: 'agent',
      contentDelta: 'hello world',
    })

    batcher.dispose()
    vi.useRealTimers()
  })

  test('flushes pending text before applying a critical permission request', async () => {
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
    await batcher.flushSession('sess-batch', (ev) => { applied.push(ev) })

    expect(applied).toHaveLength(2)
    expect(applied[0].data).toMatchObject({ messageId: 'msg-1', contentDelta: 'before permission' })
    expect(applied[1].data).toMatchObject({ messageId: 'permission-1', permissionRequest: { id: 'permission-1' } })

    batcher.dispose()
    vi.useRealTimers()
  })

  test('waits for pending and in-flight asynchronous persistence before resolving flush', async () => {
    const batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })
    const order: string[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    const apply = async (ev: SessionUpdateEnvelope): Promise<void> => {
      order.push(`start:${ev.data.messageId}`)
      await gate
      order.push(`done:${ev.data.messageId}`)
    }
    batcher.handle(envelope({ messageId: 'msg-async', role: 'agent', contentDelta: 'pending' }), apply)

    let settled = false
    const flushing = batcher.flushSession('sess-batch', apply).then(() => { settled = true })
    await Promise.resolve()

    expect(order).toEqual(['start:msg-async'])
    expect(settled).toBe(false)
    release?.()
    await flushing
    expect(order).toEqual(['start:msg-async', 'done:msg-async'])
    batcher.dispose()
  })

  test('propagates a session persistence failure without blocking another session', async () => {
    const batcher = new SessionUpdateBatcher({ textFlushMs: 100, processFlushMs: 300 })
    const failed = { ...envelope({ messageId: 'msg-failed', role: 'agent', contentDelta: 'bad' }), sessionId: 'session-failed' }
    const healthy = { ...envelope({ messageId: 'msg-healthy', role: 'agent', contentDelta: 'good' }), sessionId: 'session-healthy' }
    const apply = async (ev: SessionUpdateEnvelope): Promise<void> => {
      if (ev.sessionId === 'session-failed') throw new Error('persistence failed')
    }
    batcher.handle(failed, apply)
    batcher.handle(healthy, apply)

    await expect(batcher.flushSession('session-failed', apply)).rejects.toThrow('persistence failed')
    await expect(batcher.flushSession('session-healthy', apply)).resolves.toBeUndefined()
    batcher.dispose()
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
