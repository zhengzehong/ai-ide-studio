import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { describe, expect, test, vi } from 'vitest'
import type { WorkerRequest, WorkerResponse } from '../../src/data-worker/protocol.js'
import {
  WorkerRequestError,
  WorkerRpcClient,
  type LateWorkerResponse,
} from '../../src/data-worker/worker-rpc-client.js'

class FakeWorker extends EventEmitter {
  readonly requests: WorkerRequest[] = []

  postMessage(message: WorkerRequest): void {
    this.requests.push(message)
  }

  emitResponse(message: WorkerResponse): void {
    this.emit('message', message)
  }

  terminate(): Promise<number> {
    return Promise.resolve(0)
  }
}

describe('WorkerRpcClient observability', () => {
  test('reports API delivery delay separately from Worker execution', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const client = new WorkerRpcClient(worker as unknown as Worker)
      const pending = client.request<string>('sessions.messages', {}, { priority: 'interactive' })
      const request = worker.requests[0]

      await vi.advanceTimersByTimeAsync(250)
      worker.emitResponse({
        kind: 'result',
        requestId: request.requestId,
        result: 'ok',
        metrics: {
          queueDepth: 1,
          queueWaitMs: 2,
          executionMs: 8,
          totalMs: 10,
          payloadBytes: request.payloadBytes,
        },
      })

      await expect(pending).resolves.toMatchObject({
        result: 'ok',
        metrics: {
          workerTotalMs: 10,
          clientObservedMs: 250,
          deliveryLagMs: 240,
        },
      })
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  test('reports a bounded late response after the client timeout', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const lateResponses: LateWorkerResponse[] = []
      const client = new WorkerRpcClient(worker as unknown as Worker, {
        defaultTimeoutMs: 50,
        onLateResponse: (response) => lateResponses.push(response),
      })
      const pending = client.request('writer.command.enqueue', {}, { priority: 'interactive' })
      const request = worker.requests[0]

      const rejection = expect(pending).rejects.toMatchObject<Partial<WorkerRequestError>>({
        code: 'DEADLINE_EXCEEDED',
        clientObservedMs: 50,
        requestId: request.requestId,
        operation: 'writer.command.enqueue',
      })
      await vi.advanceTimersByTimeAsync(50)
      await rejection
      await vi.advanceTimersByTimeAsync(150)
      worker.emitResponse({
        kind: 'result',
        requestId: request.requestId,
        result: { accepted: true },
        metrics: {
          queueDepth: 0,
          queueWaitMs: 1,
          executionMs: 4,
          totalMs: 5,
          payloadBytes: request.payloadBytes,
        },
      })

      expect(lateResponses).toEqual([expect.objectContaining({
        requestId: request.requestId,
        operation: 'writer.command.enqueue',
        responseKind: 'result',
        pendingCountAtResponse: 0,
        workerTotalMs: 5,
        clientObservedMs: 200,
        deliveryLagMs: 195,
      })])
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps a worker-side deadline skip observable after the client already gave up', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const lateResponses: LateWorkerResponse[] = []
      const client = new WorkerRpcClient(worker as unknown as Worker, {
        defaultTimeoutMs: 50,
        onLateResponse: (response) => lateResponses.push(response),
      })
      // 客户端按 deadline 先超时(50ms),worker 随后才在出队时跳过并回 DEADLINE_EXCEEDED:
      // 这条迟到错误是"兜底生效"的证据,只是日志降级为 debug,观测字段必须完整保留
      const pending = client.request('sessions.recovery', {}, { priority: 'heavy', deadlineMs: 50 })
      const request = worker.requests[0]

      const rejection = expect(pending).rejects.toMatchObject<Partial<WorkerRequestError>>({
        code: 'DEADLINE_EXCEEDED',
        requestId: request.requestId,
      })
      await vi.advanceTimersByTimeAsync(50)
      await rejection
      await vi.advanceTimersByTimeAsync(150)
      worker.emitResponse({
        kind: 'error',
        requestId: request.requestId,
        error: { code: 'DEADLINE_EXCEEDED', message: 'Query deadline exceeded before execution: sessions.recovery' },
        metrics: {
          queueDepth: 0,
          queueWaitMs: 200,
          executionMs: 0,
          totalMs: 200,
          payloadBytes: request.payloadBytes,
        },
      })

      expect(lateResponses).toEqual([expect.objectContaining({
        requestId: request.requestId,
        operation: 'sessions.recovery',
        responseKind: 'error',
        workerErrorCode: 'DEADLINE_EXCEEDED',
        timedOutAfterMs: 50,
      })])
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
