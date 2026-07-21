import { describe, expect, test } from 'vitest'
import {
  RuntimeBackpressureError,
  RuntimeSessionActorScheduler,
} from '../../src/runtime/actors/session-actor.js'

describe('RuntimeSessionActorScheduler', () => {
  test('serializes one Session while allowing other Sessions to progress', async () => {
    const scheduler = new RuntimeSessionActorScheduler({ generationFactory: () => 'generation-1' })
    const order: string[] = []
    let releaseA: (() => void) | undefined
    const gateA = new Promise<void>((resolve) => { releaseA = resolve })

    const a1 = scheduler.enqueue('session-a', async () => {
      order.push('a1:start')
      await gateA
      order.push('a1:end')
    })
    const a2 = scheduler.enqueue('session-a', async () => { order.push('a2') })
    const b1 = scheduler.enqueue('session-b', async () => { order.push('b1') })

    await b1
    expect(order).toEqual(['a1:start', 'b1'])
    releaseA?.()
    await Promise.all([a1, a2])
    expect(order).toEqual(['a1:start', 'b1', 'a1:end', 'a2'])
  })

  test('keeps one generation and increments only emitted logical cursors', () => {
    let generation = 0
    const scheduler = new RuntimeSessionActorScheduler({
      generationFactory: () => `generation-${++generation}`,
    })

    expect(scheduler.currentCursor('session-a')).toEqual({ streamGeneration: 'generation-1', sequence: 0 })
    expect(scheduler.nextCursor('session-a')).toEqual({ streamGeneration: 'generation-1', sequence: 1 })
    expect(scheduler.nextCursor('session-a')).toEqual({ streamGeneration: 'generation-1', sequence: 2 })
    scheduler.resetSession('session-a')
    expect(scheduler.nextCursor('session-a')).toEqual({ streamGeneration: 'generation-2', sequence: 1 })
  })

  test('starts a fresh stream generation after a terminal cancellation fence', () => {
    let generation = 0
    const scheduler = new RuntimeSessionActorScheduler({
      generationFactory: () => `generation-${++generation}`,
    })

    expect(scheduler.nextCursor('session-a')).toEqual({ streamGeneration: 'generation-1', sequence: 1 })
    scheduler.fenceSession('session-a')
    expect(scheduler.currentCursor('session-a')).toEqual({ streamGeneration: 'generation-2', sequence: 0 })
  })

  test('rejects overflow without dropping accepted work', async () => {
    const scheduler = new RuntimeSessionActorScheduler({ maxMailboxItems: 2, maxMailboxBytes: 16 })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = scheduler.enqueue('session-a', () => gate, { payloadBytes: 8 })
    const second = scheduler.enqueue('session-a', async () => undefined, { payloadBytes: 8 })

    await expect(scheduler.enqueue('session-a', async () => undefined, { payloadBytes: 1 }))
      .rejects.toBeInstanceOf(RuntimeBackpressureError)
    expect(scheduler.pendingCount('session-a')).toBe(2)

    release?.()
    await Promise.all([first, second])
  })

  test('starts thirty independent Session actors without starvation', async () => {
    const scheduler = new RuntimeSessionActorScheduler()
    const started: string[] = []
    await Promise.all(Array.from({ length: 30 }, (_, index) => {
      const sessionId = `session-${index}`
      return scheduler.enqueue(sessionId, async () => { started.push(sessionId) })
    }))
    expect(new Set(started).size).toBe(30)
  })
})
