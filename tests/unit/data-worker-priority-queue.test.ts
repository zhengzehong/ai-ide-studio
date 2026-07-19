import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { StablePriorityQueue } from '../../src/data-worker/priority-queue.js'
import {
  WorkerRequestError,
  WorkerRpcClient,
} from '../../src/data-worker/worker-rpc-client.js'

describe('StablePriorityQueue', () => {
  it('dequeues higher priorities first and preserves FIFO within each priority', () => {
    const queue = new StablePriorityQueue(['critical', 'interactive', 'background'] as const)

    queue.enqueue('background-1', 'background', { now: 10 })
    queue.enqueue('interactive-1', 'interactive', { now: 11 })
    queue.enqueue('critical-1', 'critical', { now: 12 })
    queue.enqueue('interactive-2', 'interactive', { now: 13 })
    queue.enqueue('critical-2', 'critical', { now: 14 })
    queue.enqueue('background-2', 'background', { now: 15 })

    expect(drainValues(queue, 20)).toEqual([
      'critical-1',
      'critical-2',
      'interactive-1',
      'interactive-2',
      'background-1',
      'background-2',
    ])
  })

  it('marks an item expired only when it reaches the head for execution', () => {
    const queue = new StablePriorityQueue(['interactive', 'background'] as const)

    queue.enqueue('expired', 'interactive', { now: 10, deadlineAt: 19 })
    queue.enqueue('ready', 'background', { now: 11, deadlineAt: 30 })

    expect(queue.dequeue(20)).toMatchObject({
      value: 'expired',
      expired: true,
      queueWaitMs: 10,
    })
    expect(queue.dequeue(20)).toMatchObject({
      value: 'ready',
      expired: false,
      queueWaitMs: 9,
    })
  })

  it('supports removing queued work and draining without reordering', () => {
    const queue = new StablePriorityQueue(['critical', 'interactive', 'background'] as const)
    const first = queue.enqueue('first', 'background', { now: 1 })
    queue.enqueue('second', 'interactive', { now: 2 })
    queue.enqueue('third', 'background', { now: 3 })

    expect(queue.remove(first.id)?.value).toBe('first')
    expect(queue.size).toBe(2)
    expect(queue.drain(5).map((item) => item.value)).toEqual(['second', 'third'])
    expect(queue.size).toBe(0)
  })

  it('rejects unknown priorities instead of silently treating them as background', () => {
    const queue = new StablePriorityQueue(['interactive', 'background'] as const)

    expect(() => queue.enqueue('bad', 'critical' as 'interactive', { now: 1 })).toThrow(
      'Unknown queue priority: critical',
    )
  })
})

describe('WorkerRpcClient', () => {
  const clients: WorkerRpcClient[] = []

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()))
    clients.length = 0
  })

  it('correlates concurrent results and exposes worker metrics', async () => {
    const client = createClient()

    const [first, second] = await Promise.all([
      client.request<{ value: string }>('echo', { value: 'first' }, { priority: 'interactive' }),
      client.request<{ value: string }>('echo', { value: 'second' }, { priority: 'background' }),
    ])

    expect(first.result).toEqual({ value: 'first' })
    expect(second.result).toEqual({ value: 'second' })
    expect(first.metrics).toMatchObject({ queueDepth: 0, queueWaitMs: 0 })
    expect(client.pendingCount).toBe(0)
  })

  it('times out a request, removes it from pending work, and ignores a late result', async () => {
    const client = createClient({ defaultTimeoutMs: 20 })

    await expect(
      client.request('delayed', { delayMs: 50 }, { priority: 'interactive' }),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })

    expect(client.pendingCount).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(client.pendingCount).toBe(0)
  })

  it('rejects all pending requests when the worker crashes', async () => {
    const client = createClient({ defaultTimeoutMs: 1_000 })
    const hanging = client.request('delayed', { delayMs: 500 }, { priority: 'background' })
    const crashing = client.request('crash', {}, { priority: 'interactive' })

    await expect(crashing).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await expect(hanging).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    expect(client.pendingCount).toBe(0)
  })

  it('preserves worker timing metrics on an operation error', async () => {
    const client = createClient()

    await expect(client.request('fail', {}, { priority: 'interactive' })).rejects.toMatchObject({
      code: 'SQLITE_ERROR',
      metrics: {
        queueDepth: 0,
        queueWaitMs: 0,
        executionMs: 1,
      },
    })
  })

  it('rejects new work after close and terminates without open handles', async () => {
    const client = createClient()

    await client.close()

    await expect(client.request('echo', {}, { priority: 'interactive' })).rejects.toEqual(
      expect.objectContaining<Partial<WorkerRequestError>>({ code: 'WORKER_UNAVAILABLE' }),
    )
  })

  function createClient(options: { defaultTimeoutMs?: number } = {}): WorkerRpcClient {
    const worker = new Worker(workerFixtureSource(), { eval: true })
    const client = new WorkerRpcClient(worker, options)
    clients.push(client)
    return client
  }
})

function drainValues<T>(queue: StablePriorityQueue<T, string>, now: number): T[] {
  const values: T[] = []
  while (queue.size > 0) {
    const item = queue.dequeue(now)
    if (item) values.push(item.value)
  }
  return values
}

function workerFixtureSource(): string {
  return `
    const { parentPort } = require('node:worker_threads')
    parentPort.on('message', (request) => {
      if (request.operation === 'crash') throw new Error('fixture crash')
      if (request.operation === 'fail') {
        parentPort.postMessage({
          kind: 'error',
          requestId: request.requestId,
          error: { code: 'SQLITE_ERROR', message: 'fixture failure' },
          metrics: {
            queueDepth: 0,
            queueWaitMs: 0,
            executionMs: 1,
            totalMs: 1,
            payloadBytes: request.payloadBytes,
          },
        })
        return
      }
      const reply = () => parentPort.postMessage({
        kind: 'result',
        requestId: request.requestId,
        result: request.payload,
        metrics: {
          queueDepth: 0,
          queueWaitMs: 0,
          executionMs: 1,
          totalMs: 1,
          payloadBytes: request.payloadBytes,
        },
      })
      if (request.operation === 'delayed') setTimeout(reply, request.payload.delayMs)
      else reply()
    })
  `
}
