import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import { describe, expect, test, vi } from 'vitest'
import { startManagedAcpAgent } from '../../src/runtime/service/managed-acp-agent.js'

test('drains stderr and tears down the child and router when initialization fails', async () => {
  const child = fakeChild()
  const close = vi.fn()
  const connection = {
    initialize: vi.fn(async () => {
      child.stderr.write('runtime failed\n')
      throw new Error('initialize failed')
    }),
  } as unknown as acp.ClientSideConnection

  await expect(startManagedAcpAgent({
    agentId: 'agent-a',
    runtime: 'claude',
    command: { cmd: 'claude-agent-acp', args: [] },
    env: {},
    router: { client: {} as acp.Client, close } as never,
    spawnProcess: () => child.process,
    createConnection: () => connection,
  })).rejects.toThrow('initialize failed')

  expect(child.stderr.listenerCount('data')).toBeGreaterThan(0)
  expect(close).toHaveBeenCalledOnce()
  expect(child.kill).toHaveBeenCalledOnce()
})

function fakeChild(): {
  process: ChildProcess
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const emitter = new EventEmitter()
  const stderr = new PassThrough()
  const kill = vi.fn(() => true)
  return {
    stderr,
    kill,
    process: Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr,
      kill,
    }) as unknown as ChildProcess,
  }
}
