import { describe, expect, test, vi } from 'vitest'
import { runRuntimeControlRequest } from '../../src/runtime/service/runtime-control-request.js'

describe('Runtime control request response', () => {
  test('does not retry an error response when the transport closes during reply', async () => {
    const reply = vi.fn(async () => { throw new Error('IPC framed socket is closed') })

    await expect(runRuntimeControlRequest({
      execute: async () => 'result',
      reply,
      isStopping: () => false,
    })).rejects.toThrow('IPC framed socket is closed')

    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith({ result: 'result' })
  })

  test('returns one execution error response while the transport is available', async () => {
    const reply = vi.fn(async () => undefined)

    await runRuntimeControlRequest({
      execute: async () => { throw new Error('request failed') },
      reply,
      isStopping: () => false,
    })

    expect(reply).toHaveBeenCalledOnce()
    expect(reply).toHaveBeenCalledWith({ error: 'request failed' })
  })

  test('suppresses a late response after shutdown starts', async () => {
    const reply = vi.fn(async () => undefined)

    await runRuntimeControlRequest({
      execute: async () => 'late result',
      reply,
      isStopping: () => true,
    })

    expect(reply).not.toHaveBeenCalled()
  })
})
