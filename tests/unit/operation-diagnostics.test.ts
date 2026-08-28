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
})

function createClock(values: number[]): { now(): number } {
  let index = 0
  return {
    now: () => values[Math.min(index++, values.length - 1)],
  }
}
