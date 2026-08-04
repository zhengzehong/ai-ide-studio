import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  RuntimeUpdateCoalescer,
  runtimeUpdateKey,
  type RuntimeCoalescibleUpdate,
} from '../../src/runtime/streams/runtime-update-coalescer.js'

afterEach(() => vi.useRealTimers())

describe('RuntimeUpdateCoalescer', () => {
  test('concatenates text deltas on UI and persistence cadences', async () => {
    vi.useFakeTimers()
    const ui: RuntimeCoalescibleUpdate[][] = []
    const persistence: RuntimeCoalescibleUpdate[][] = []
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => { ui.push(updates) },
      emitPersistence: async (updates) => { persistence.push(updates) },
    })

    coalescer.enqueue(textDelta('hello '))
    coalescer.enqueue(textDelta('world'))
    await vi.advanceTimersByTimeAsync(25)
    expect(ui).toEqual([[textDelta('hello world')]])
    expect(persistence).toEqual([])

    await vi.advanceTimersByTimeAsync(225)
    expect(persistence).toEqual([[textDelta('hello world')]])
  })

  test('flushes a matching UI update before an already-due persistence batch', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => { order.push(`ui:${updates[0].contentDelta ?? ''}`) },
      emitPersistence: async (updates) => { order.push(`persistence:${updates[0].contentDelta ?? ''}`) },
    })

    coalescer.enqueue(textDelta('first'))
    await vi.advanceTimersByTimeAsync(25)
    await vi.advanceTimersByTimeAsync(220)
    coalescer.enqueue(textDelta('second'))
    await vi.advanceTimersByTimeAsync(5)

    expect(order).toEqual([
      'ui:first',
      'ui:second',
      'persistence:firstsecond',
    ])
  })

  test('leaves updates arriving during a UI flush for the next persistence batch', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    let releaseUi: (() => void) | undefined
    let markFirstPersisted: (() => void) | undefined
    const uiGate = new Promise<void>((resolve) => { releaseUi = resolve })
    const firstPersisted = new Promise<void>((resolve) => { markFirstPersisted = resolve })
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => {
        order.push(`ui:${updates[0].contentDelta ?? ''}`)
        if (updates[0].contentDelta === 'first') await uiGate
      },
      emitPersistence: async (updates) => {
        order.push(`persistence:${updates[0].contentDelta ?? ''}`)
        if (updates[0].contentDelta === 'first') markFirstPersisted?.()
      },
    })

    coalescer.enqueue(textDelta('first'))
    const flushing = vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(order).toEqual(['ui:first']))
    coalescer.enqueue(textDelta('second'))
    releaseUi?.()
    await flushing
    await firstPersisted

    expect(order).toEqual(['ui:first', 'persistence:first'])

    await vi.advanceTimersByTimeAsync(250)
    expect(order).toEqual([
      'ui:first',
      'persistence:first',
      'ui:second',
      'persistence:second',
    ])
  })

  test('keeps repeated same-key persistence batches bound to their UI cursor', async () => {
    vi.useFakeTimers()
    const cursors = new Map<string, { sequence: number }>()
    const persistedSequences: number[] = []
    let sequence = 0
    let releaseFirstPersistence: (() => void) | undefined
    let markFirstPersistenceStarted: (() => void) | undefined
    const firstPersistenceGate = new Promise<void>((resolve) => { releaseFirstPersistence = resolve })
    const firstPersistenceStarted = new Promise<void>((resolve) => { markFirstPersistenceStarted = resolve })
    let persistenceBatch = 0
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => {
        for (const update of updates) cursors.set(runtimeUpdateKey(update), { sequence: ++sequence })
      },
      emitPersistence: async (updates) => {
        persistenceBatch += 1
        for (const update of updates) {
          const key = runtimeUpdateKey(update)
          const cursor = cursors.get(key)
          if (!cursor) throw new Error(`missing UI cursor: ${key}`)
          persistedSequences.push(cursor.sequence)
          if (persistenceBatch === 1) {
            markFirstPersistenceStarted?.()
            await firstPersistenceGate
          }
          if (cursors.get(key) === cursor) cursors.delete(key)
        }
      },
    })

    coalescer.enqueue(thinkingDelta('first'))
    await vi.advanceTimersByTimeAsync(25)
    const firstFlush = coalescer.flushSession('session-1')
    await firstPersistenceStarted

    coalescer.enqueue(thinkingDelta('second'))
    await vi.advanceTimersByTimeAsync(25)
    const secondFlush = coalescer.flushSession('session-1')

    coalescer.enqueue(thinkingDelta('third'))
    await vi.advanceTimersByTimeAsync(25)
    const thirdFlush = coalescer.flushSession('session-1')

    releaseFirstPersistence?.()
    await expect(Promise.all([firstFlush, secondFlush, thirdFlush])).resolves.toBeDefined()
    expect(persistedSequences).toEqual([1, 3])
  })

  test('continues flushing after a timer-driven UI batch fails', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const emitted: string[] = []
    let attempt = 0
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 1_000,
      emitUi: async (updates) => {
        attempt += 1
        if (attempt === 1) throw new Error('temporary UI failure')
        emitted.push(updates[0]?.contentDelta ?? '')
      },
      emitPersistence: async () => undefined,
      onError,
    })

    coalescer.enqueue(textDelta('first'))
    await vi.advanceTimersByTimeAsync(25)
    coalescer.enqueue(textDelta('second'))
    await vi.advanceTimersByTimeAsync(25)

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'temporary UI failure' }), 'ui')
    expect(emitted).toEqual(['second'])
    coalescer.close()
  })

  test('still rejects an explicitly awaited flush while keeping later writes usable', async () => {
    let attempt = 0
    const persistence: string[] = []
    const coalescer = new RuntimeUpdateCoalescer({
      emitUi: async () => undefined,
      emitPersistence: async (updates) => {
        attempt += 1
        if (attempt === 1) throw new Error('temporary persistence failure')
        persistence.push(updates[0]?.contentDelta ?? '')
      },
    })

    coalescer.enqueue(textDelta('first'))
    await expect(coalescer.flushSession('session-1')).rejects.toThrow('temporary persistence failure')

    coalescer.enqueue(textDelta('second'))
    await expect(coalescer.flushSession('session-1')).resolves.toBeUndefined()
    expect(persistence).toEqual(['second'])
    coalescer.close()
  })

  test('keeps only the latest process progress for each process item', async () => {
    vi.useFakeTimers()
    const ui: RuntimeCoalescibleUpdate[][] = []
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => { ui.push(updates) },
      emitPersistence: async () => undefined,
    })

    coalescer.enqueue(processUpdate('running', '10%'))
    coalescer.enqueue(processUpdate('running', '90%'))
    await vi.advanceTimersByTimeAsync(25)

    expect(ui).toEqual([[processUpdate('running', '90%')]])
  })

  test('flushes pending updates before a critical interaction', async () => {
    vi.useFakeTimers()
    const ui: RuntimeCoalescibleUpdate[][] = []
    const persistence: RuntimeCoalescibleUpdate[][] = []
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async (updates) => { ui.push(updates) },
      emitPersistence: async (updates) => { persistence.push(updates) },
    })

    coalescer.enqueue(textDelta('before'))
    await coalescer.enqueueCritical({
      kind: 'interaction',
      sessionId: 'session-1',
      messageId: 'permission-1',
      interactionType: 'permission',
    })

    expect(ui).toEqual([[textDelta('before')], [{
      kind: 'interaction',
      sessionId: 'session-1',
      messageId: 'permission-1',
      interactionType: 'permission',
    }]])
    expect(persistence).toEqual(ui)
  })

  test('does not merge tool lifecycle data with system usage updates', async () => {
    vi.useFakeTimers()
    const persistence: RuntimeCoalescibleUpdate[][] = []
    const coalescer = new RuntimeUpdateCoalescer({
      uiFlushMs: 25,
      persistenceFlushMs: 250,
      emitUi: async () => undefined,
      emitPersistence: async (updates) => { persistence.push(updates) },
    })
    const toolCall = sessionUpdate({
      messageId: 'message-1',
      role: 'agent',
      toolCall: { id: 'tool-1', title: 'files.present', status: 'in_progress' },
    })
    const usage = sessionUpdate({
      messageId: 'message-1',
      role: 'system',
      usage: { contextSize: 200_000, contextUsed: 10_000 },
    })

    coalescer.enqueue(toolCall)
    coalescer.enqueue(usage)
    await vi.advanceTimersByTimeAsync(250)

    expect(persistence).toEqual([[toolCall, usage]])
  })
})

function textDelta(contentDelta: string): RuntimeCoalescibleUpdate {
  return {
    kind: 'session-update',
    sessionId: 'session-1',
    messageId: 'message-1',
    contentDelta,
  }
}

function processUpdate(status: string, progress: string): RuntimeCoalescibleUpdate {
  return {
    kind: 'process-item',
    sessionId: 'session-1',
    messageId: 'message-1',
    processItemId: 'process-1',
    status,
    progress,
  }
}

function thinkingDelta(thinking: string): RuntimeCoalescibleUpdate {
  return sessionUpdate({ messageId: 'message-1', role: 'agent', thinking })
}

function sessionUpdate(data: Record<string, unknown>): RuntimeCoalescibleUpdate {
  return {
    kind: 'session-update',
    sessionId: 'session-1',
    messageId: 'message-1',
    data,
  }
}
