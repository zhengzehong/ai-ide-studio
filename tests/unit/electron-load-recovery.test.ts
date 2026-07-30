import { describe, expect, test, vi } from 'vitest'
import { runLoadRecovery, type LoadRecoveryChoice } from '../../electron/load-recovery.js'

describe('Electron page load recovery', () => {
  test('keeps offering recovery after repeated reload failures', async () => {
    const choices: LoadRecoveryChoice[] = ['retry', 'retry', 'quit']
    const choose = vi.fn(async () => choices.shift() ?? 'quit')
    const reload = vi.fn()
      .mockRejectedValueOnce(new Error('second failure'))
      .mockRejectedValueOnce(new Error('third failure'))
    const quit = vi.fn()

    await runLoadRecovery('first failure', {
      isClosed: () => false,
      choose,
      reload,
      editConnection: async () => 'cancelled',
      quit,
    })

    expect(choose.mock.calls.map(([message]) => message)).toEqual([
      'first failure',
      'second failure',
      'third failure',
    ])
    expect(reload).toHaveBeenCalledTimes(2)
    expect(quit).toHaveBeenCalledOnce()
  })

  test('returns to recovery choices after editing is cancelled', async () => {
    const choices: LoadRecoveryChoice[] = ['edit', 'quit']
    const choose = vi.fn(async () => choices.shift() ?? 'quit')
    const editConnection = vi.fn(async () => 'cancelled' as const)
    const quit = vi.fn()

    await runLoadRecovery('offline', {
      isClosed: () => false,
      choose,
      reload: async () => undefined,
      editConnection,
      quit,
    })

    expect(choose).toHaveBeenCalledTimes(2)
    expect(editConnection).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })
})
