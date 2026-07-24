import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  RuntimeUpdateCoalescer,
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

function sessionUpdate(data: Record<string, unknown>): RuntimeCoalescibleUpdate {
  return {
    kind: 'session-update',
    sessionId: 'session-1',
    messageId: 'message-1',
    data,
  }
}
