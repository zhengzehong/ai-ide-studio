import { describe, expect, it } from 'vitest'
import { WorkerRequestError } from '../../src/data-worker/worker-rpc-client.js'
import {
  createWorkerQueryPool,
  parseQueryWorkerPoolSize,
  type WorkerQueryPool,
} from '../../src/queries/worker-query-pool.js'
import type { WorkerQueryPort } from '../../src/queries/worker-query-port.js'
import type { WorkerQueryInspection } from '../../src/data-worker/query-worker/operations.js'

/** P0-3b:查询并发池的路由/隔离/关闭。用注入的假端口验证分配策略,不启动真实 worker。 */
class FakePort implements WorkerQueryPort {
  readonly calls: string[] = []
  hold = false
  failListTasks: WorkerRequestError | undefined
  closed = false
  private releases: Array<() => void> = []

  constructor(readonly label: string) {}

  listTasks(): Promise<never[]> {
    this.calls.push('listTasks')
    if (this.failListTasks) return Promise.reject(this.failListTasks)
    if (!this.hold) return Promise.resolve([])
    return new Promise((resolve) => {
      this.releases.push(() => resolve([]))
    })
  }

  listTaskPage(): Promise<never> {
    this.calls.push('listTaskPage')
    return Promise.reject(new Error('unused'))
  }

  listSessions(): Promise<never[]> {
    this.calls.push('listSessions')
    return Promise.resolve([])
  }

  listSessionMessages(): Promise<never> {
    this.calls.push('listSessionMessages')
    return Promise.reject(new Error('unused'))
  }

  listSessionEvents(): Promise<never> {
    this.calls.push('listSessionEvents')
    return Promise.reject(new Error('unused'))
  }

  getSessionRecovery(): Promise<never> {
    this.calls.push('getSessionRecovery')
    return Promise.reject(new Error('unused'))
  }

  listWidgetSessions(): Promise<never[]> {
    this.calls.push('listWidgetSessions')
    return Promise.resolve([])
  }

  inspect(): Promise<WorkerQueryInspection> {
    return Promise.resolve({
      mode: 'readonly',
      queryOnly: true,
      threadId: this.label.charCodeAt(0),
      executedRequests: this.calls.length,
      skippedExpiredRequests: 0,
    })
  }

  diagnose(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }

  terminate(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }

  release(): void {
    const releases = this.releases
    this.releases = []
    for (const release of releases) release()
  }
}

async function createPool(
  poolSize: number,
  configure: (ports: FakePort[], index: number) => void = () => undefined,
): Promise<{ pool: WorkerQueryPool; ports: FakePort[] }> {
  const ports: FakePort[] = []
  const pool = await createWorkerQueryPool({
    dbPath: 'unused.sqlite',
    poolSize,
    createPort: async () => {
      const port = new FakePort(`worker-${ports.length}`)
      ports.push(port)
      configure(ports, ports.length - 1)
      return port as unknown as WorkerQueryPort
    },
  })
  return { pool, ports }
}

describe('parseQueryWorkerPoolSize', () => {
  it('accepts 1 (legacy single-worker) and clamps absent or invalid values to the default', () => {
    expect(parseQueryWorkerPoolSize('1')).toBe(1)
    expect(parseQueryWorkerPoolSize('3')).toBe(3)
    expect(parseQueryWorkerPoolSize(undefined)).toBe(2)
    expect(parseQueryWorkerPoolSize('')).toBe(2)
    expect(parseQueryWorkerPoolSize('  ')).toBe(2)
    expect(parseQueryWorkerPoolSize('abc')).toBe(2)
    expect(parseQueryWorkerPoolSize('0')).toBe(2)
    expect(parseQueryWorkerPoolSize('-4')).toBe(2)
    // 防止环境变量写错时拉起一屏 worker
    expect(parseQueryWorkerPoolSize('99')).toBe(8)
  })
})

describe('query worker pool', () => {
  it('creates the configured number of workers and closes all of them', async () => {
    const { pool, ports } = await createPool(2)

    expect(ports).toHaveLength(2)
    await pool.close()
    expect(ports.map((port) => port.closed)).toEqual([true, true])
  })

  it('routes a new query to the least-loaded worker', async () => {
    const { pool, ports } = await createPool(2)
    const [first, second] = ports as [FakePort, FakePort]
    first.hold = true
    second.hold = true

    const firstCall = pool.listTasks({})
    const secondCall = pool.listTasks({})
    expect(first.calls).toEqual(['listTasks'])
    expect(second.calls).toEqual(['listTasks'])

    // A 空闲下来、B 仍在飞 → 下一次请求必须回到 A
    first.hold = false
    first.release()
    await firstCall
    void pool.listTasks({})
    expect(first.calls).toEqual(['listTasks', 'listTasks'])
    expect(second.calls).toEqual(['listTasks'])

    second.hold = false
    second.release()
    await secondCall
    await pool.close()
  })

  it('rotates between idle workers instead of always picking the first', async () => {
    const { pool, ports } = await createPool(2)

    await Promise.all([
      pool.listTasks({}),
      pool.listTasks({}),
      pool.listTasks({}),
      pool.listTasks({}),
    ])

    expect(ports.map((port) => port.calls.length)).toEqual([2, 2])
    await pool.close()
  })

  it('keeps serving from a healthy worker after the other one becomes unavailable', async () => {
    const { pool, ports } = await createPool(2)
    const [first, second] = ports as [FakePort, FakePort]
    first.failListTasks = new WorkerRequestError('WORKER_UNAVAILABLE', 'worker exited with code 1')

    await expect(pool.listTasks({})).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await expect(pool.listTasks({})).resolves.toEqual([])
    await expect(pool.listTasks({})).resolves.toEqual([])

    expect(first.calls).toEqual(['listTasks'])
    expect(second.calls).toEqual(['listTasks', 'listTasks'])
    await pool.close()
  })

  it('exposes every worker inspection for queue-depth visibility', async () => {
    const { pool } = await createPool(2)

    const inspections = await pool.inspectAll()

    expect(inspections).toHaveLength(2)
    expect(inspections.map((item) => item.queryOnly)).toEqual([true, true])
    await pool.close()
  })

  it('behaves like a single worker when the pool size is 1', async () => {
    const { pool, ports } = await createPool(1)

    await pool.listTasks({})
    await pool.listTasks({})
    await pool.listWidgetSessions({})

    expect(ports).toHaveLength(1)
    expect(ports[0]?.calls).toEqual(['listTasks', 'listTasks', 'listWidgetSessions'])
    await pool.close()
  })
})
