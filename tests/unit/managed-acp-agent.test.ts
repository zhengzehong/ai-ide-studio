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

test('passes an explicit working directory to the ACP child process', async () => {
  const child = fakeChild()
  const connection = {
    initialize: vi.fn(async () => ({ agentCapabilities: {} })),
  } as unknown as acp.ClientSideConnection
  let spawnOptions: Parameters<NonNullable<Parameters<typeof startManagedAcpAgent>[0]['spawnProcess']>>[2]

  await startManagedAcpAgent({
    agentId: 'agent-a',
    runtime: 'claude',
    command: { cmd: 'claude-agent-acp', args: [] },
    env: {},
    cwd: 'C:\\workspace\\project',
    router: { client: {} as acp.Client, close: vi.fn() } as never,
    spawnProcess: (_command, _args, options) => {
      spawnOptions = options
      return child.process
    },
    createConnection: () => connection,
  })

  expect(spawnOptions?.cwd).toBe('C:\\workspace\\project')
})

test('authenticates a configured Codex gateway after initialization', async () => {
  const child = fakeChild()
  const order: string[] = []
  const authenticate = vi.fn(async () => { order.push('authenticate') })
  const connection = {
    initialize: vi.fn(async () => {
      order.push('initialize')
      return { agentCapabilities: {} }
    }),
    authenticate,
  } as unknown as acp.ClientSideConnection

  await startManagedAcpAgent({
    agentId: 'agent-a',
    runtime: 'codex',
    command: { cmd: 'codex-acp', args: [] },
    env: {},
    gatewayAuth: {
      methodId: 'gateway',
      baseUrl: 'https://gateway.example.com/v1',
      providerName: 'Gateway',
      headers: { Authorization: 'Bearer secret' },
      fingerprint: 'safe-fingerprint',
    },
    router: { client: {} as acp.Client, close: vi.fn() } as never,
    spawnProcess: () => child.process,
    createConnection: () => connection,
  })

  expect(order).toEqual(['initialize', 'authenticate'])
  expect(authenticate).toHaveBeenCalledWith({
    methodId: 'gateway',
    _meta: {
      gateway: {
        baseUrl: 'https://gateway.example.com/v1',
        providerName: 'Gateway',
        headers: { Authorization: 'Bearer secret' },
      },
    },
  })
})

test('tears down the child and router when gateway authentication fails', async () => {
  const child = fakeChild()
  const close = vi.fn()
  const connection = {
    initialize: vi.fn(async () => ({ agentCapabilities: {} })),
    authenticate: vi.fn(async () => { throw new Error('gateway rejected') }),
  } as unknown as acp.ClientSideConnection

  await expect(startManagedAcpAgent({
    agentId: 'agent-a',
    runtime: 'codex',
    command: { cmd: 'codex-acp', args: [] },
    env: {},
    gatewayAuth: {
      methodId: 'gateway',
      baseUrl: 'https://gateway.example.com/v1',
      providerName: 'Gateway',
      headers: { Authorization: 'Bearer secret' },
      fingerprint: 'safe-fingerprint',
    },
    router: { client: {} as acp.Client, close } as never,
    spawnProcess: () => child.process,
    createConnection: () => connection,
  })).rejects.toThrow('gateway rejected')

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
