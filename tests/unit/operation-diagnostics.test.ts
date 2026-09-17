import { describe, expect, it } from 'vitest'
import { createOperationDiagnostics } from '../../src/shared/operation-diagnostics.js'

describe('operation diagnostics', () => {
  it('separates active async work from completed synchronous operations', async () => {
    const clock = createClock([100, 125, 140, 175])
    const diagnostics = createOperationDiagnostics({ now: clock.now, maxRecentOperations: 2 })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })

    const pending = diagnostics.trackAsync(
      { operationModule: 'rule-engine', operation: 'execute', context: { ruleId: 'rule-1' } },
      async () => gate,
    )
    diagnostics.trackSync(
      { operationModule: 'rule-engine', operation: 'execution.store.create', context: { ruleId: 'rule-1' } },
      () => 'stored',
    )

    expect(diagnostics.snapshot()).toMatchObject({
      activeOperationCount: 1,
      activeOperations: [{ operationModule: 'rule-engine', operation: 'execute', context: { ruleId: 'rule-1' } }],
      recentSyncOperations: [{
        operationModule: 'rule-engine',
        operation: 'execution.store.create',
        elapsedMs: 15,
        context: { ruleId: 'rule-1' },
      }],
    })

    release?.()
    await pending
    expect(diagnostics.snapshot().activeOperationCount).toBe(0)
  })

  it('keeps the slowest operations for the sampling window and preserves thrown errors', () => {
    const clock = createClock([0, 10, 20, 40, 50, 80])
    const diagnostics = createOperationDiagnostics({ now: clock.now, maxRecentOperations: 2 })

    diagnostics.trackSync({ operationModule: 'first', operation: 'run' }, () => undefined)
    expect(() => diagnostics.trackSync(
      { operationModule: 'second', operation: 'run' },
      () => { throw new Error('expected') },
    )).toThrow('expected')
    diagnostics.trackSync({ operationModule: 'third', operation: 'run' }, () => undefined)

    expect(diagnostics.snapshot().recentSyncOperations.map((item) => item.operationModule))
      .toEqual(['third', 'second'])
  })

  it('clears completed operations after a sampling window is consumed', () => {
    const clock = createClock([0, 25, 30])
    const diagnostics = createOperationDiagnostics({ now: clock.now })

    diagnostics.trackSync({ operationModule: 'store:session', operation: 'mark-read' }, () => undefined)

    expect(diagnostics.consumeSnapshot().recentSyncOperations).toHaveLength(1)
    expect(diagnostics.snapshot().recentSyncOperations).toEqual([])
  })

  it('splits wall time into cpu and io wait, keeping them non-negative and additive', () => {
    const clock = createClock([0, 120])
    const diagnostics = createOperationDiagnostics({ now: clock.now })

    diagnostics.trackSync({ operationModule: 'gateway:rpc', operation: 'handler.invoke' }, () => undefined)

    const [snapshot] = diagnostics.snapshot().recentSyncOperations
    expect(snapshot?.elapsedMs).toBe(120)
    expect(snapshot?.cpuMs).toBeGreaterThanOrEqual(0)
    expect(snapshot?.ioWaitMs).toBeGreaterThanOrEqual(0)
    // cpu + io == wall,且 cpu 不会被算成比墙钟还大
    expect((snapshot?.cpuMs ?? 0) + (snapshot?.ioWaitMs ?? 0)).toBeCloseTo(snapshot?.elapsedMs ?? 0, 5)
    expect(snapshot?.cpuMs).toBeLessThanOrEqual(snapshot?.elapsedMs ?? 0)
    // 空操作几乎不吃 CPU → 时间应几乎全部归到 ioWait(在本用例里是"等待"而非"计算")
    expect(snapshot?.ioWaitMs).toBeGreaterThan((snapshot?.cpuMs ?? 0))
  })

  it('attributes a CPU-bound synchronous block mostly to cpu, not io wait', () => {
    const diagnostics = createOperationDiagnostics()

    diagnostics.trackSync({ operationModule: 'gateway:rpc', operation: 'cpu.burn' }, () => {
      const until = Date.now() + 40
      let sink = 0
      while (Date.now() < until) sink += Math.sqrt(sink + 1)
      return sink
    })

    const [snapshot] = diagnostics.snapshot().recentSyncOperations
    expect(snapshot?.elapsedMs).toBeGreaterThanOrEqual(35)
    // 纯计算:CPU 时间应占墙钟的一半以上(留足调度抖动余量)
    expect(snapshot?.cpuMs ?? 0).toBeGreaterThan((snapshot?.elapsedMs ?? 0) / 2)
    expect(snapshot?.ioWaitMs ?? 0).toBeLessThan((snapshot?.elapsedMs ?? 0) / 2)
  })
})

function createClock(values: number[]): { now(): number } {
  let index = 0
  return {
    now: () => values[Math.min(index++, values.length - 1)],
  }
}
