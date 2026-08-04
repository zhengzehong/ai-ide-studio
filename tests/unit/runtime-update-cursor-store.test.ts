import { describe, expect, test } from 'vitest'
import {
  RuntimeUpdateCursorStore,
  type RuntimeStreamCursor,
} from '../../src/runtime/streams/runtime-update-cursor-store.js'
import type { RuntimeCoalescibleUpdate } from '../../src/runtime/streams/runtime-update-coalescer.js'

describe('RuntimeUpdateCursorStore', () => {
  test('keeps an entire persistence batch bound to the cursors visible before its first await', () => {
    const store = new RuntimeUpdateCursorStore()
    const slow = toolUpdate('slow-tool')
    const target = toolUpdate('target-tool')
    const slowCursor = cursor(1)
    const oldTargetCursor = cursor(2)
    const newTargetCursor = cursor(3)
    store.assign(slow, slowCursor)
    store.assign(target, oldTargetCursor)

    const batch = store.capturePersistenceBatch([slow, target])
    store.assign(target, newTargetCursor)

    store.release(batch[0]!)
    store.release(batch[1]!)
    const nextBatch = store.capturePersistenceBatch([target])

    expect(batch.map((item) => item.cursor.sequence)).toEqual([1, 2])
    expect(nextBatch[0]?.cursor.sequence).toBe(3)
  })

  test('fails before sending any persistence item when a batch cursor is missing', () => {
    const store = new RuntimeUpdateCursorStore()
    store.assign(toolUpdate('known-tool'), cursor(1))

    expect(() => store.capturePersistenceBatch([
      toolUpdate('known-tool'),
      toolUpdate('missing-tool'),
    ])).toThrow('Runtime persistence update has no UI cursor')
  })
})

function toolUpdate(toolCallId: string): RuntimeCoalescibleUpdate {
  return {
    kind: 'session-update',
    sessionId: 'session-1',
    messageId: 'message-1',
    data: {
      role: 'agent',
      toolCallUpdate: { id: toolCallId, status: 'in_progress' },
    },
  }
}

function cursor(sequence: number): RuntimeStreamCursor {
  return { streamGeneration: 'generation-1', sequence }
}
