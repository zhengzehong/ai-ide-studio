import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import {
  createWorkerQueryPort,
  DEFAULT_DEADLINES,
  DEFAULT_PRIORITIES,
  DEFAULT_TIMEOUTS,
  type WorkerQueryPort,
} from '../../src/queries/worker-query-port.js'

/**
 * P0-3a(2026-09-16 卡顿事故):查询 worker 的 deadline 兜底、heavy 分档、在飞合并。
 * 核心不变量:deadline 必须晚于客户端超时 —— 它是"没人要的工作别执行"的兜底,
 * 不能变成与客户端赛跑(deadline 一旦更小,rpc 客户端 timeoutMs 会被一起改小)。
 */
let tmp: string
let dbPath: string
let workerPort: WorkerQueryPort | undefined
let projectId: string
let sessionId: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-query-priority-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
  const project = projectStore.create({ name: 'Priority Project', workDir: 'D:/query-priority' })
  projectId = project.id
  const agent = agentStore.create({ name: 'Priority Agent', type: 'dev', runtime: 'mock', projectId })
  sessionId = sessionStore.create({ agentId: agent.id, projectId }).id
})

afterEach(async () => {
  await workerPort?.close()
  workerPort = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Query Worker deadline and priority (P0-3a)', () => {
  it('keeps every default deadline later than the client timeout', () => {
    const CLIENT_DEFAULT_TIMEOUT_MS = 10_000
    expect(Object.keys(DEFAULT_DEADLINES).sort()).toEqual([
      'sessions.events',
      'sessions.list',
      'sessions.messages',
      'sessions.recovery',
      'tasks.list',
      'tasks.page',
      'widget.sessions.list',
    ])
    for (const [operation, deadlineMs] of Object.entries(DEFAULT_DEADLINES)) {
      const timeoutMs = DEFAULT_TIMEOUTS[operation] ?? CLIENT_DEFAULT_TIMEOUT_MS
      expect(deadlineMs, operation).toBeGreaterThan(timeoutMs)
    }
    // 唯一放宽客户端超时的查询:recovery 实测量级 14.7s,10s 必失败;13s 仍留 2s 余量给 UI 的 15s 预算
    expect(DEFAULT_TIMEOUTS['sessions.recovery']).toBe(13_000)
    expect(DEFAULT_DEADLINES['sessions.recovery']).toBe(15_000)
    // 分档表必须与 deadline 表同域,避免写错 operation 名后静默失效
    for (const operation of Object.keys(DEFAULT_PRIORITIES)) {
      expect(DEFAULT_DEADLINES, operation).toHaveProperty(operation)
    }
    expect(DEFAULT_PRIORITIES['sessions.recovery']).toBe('heavy')
  })

  it('still answers a heavy recovery query that carries the default heavy tier', async () => {
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })

    // heavy 档曾因 worker 入站校验只认 interactive/background 而被静默丢弃(客户端只能等超时)
    await expect(workerPort.getSessionRecovery({ sessionId, limit: 20 }))
      .resolves.toMatchObject({ sessionId, latestSequence: 0 })
  })

  it('runs a queued interactive query before an earlier-queued heavy recovery', async () => {
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    const completionOrder: string[] = []

    const blocker = workerPort
      .diagnose({ label: 'blocker', blockMs: 300 }, { priority: 'interactive' })
      .then(() => completionOrder.push('blocker'))
    await delay(30)
    const heavy = workerPort
      .getSessionRecovery({ sessionId, limit: 20 })
      .then(() => completionOrder.push('heavy'))
    const interactive = workerPort
      .listTasks({ projectId })
      .then(() => completionOrder.push('interactive'))

    await Promise.all([blocker, heavy, interactive])

    // recovery 先入队,但它跑 14.7s 量级,必须给后面的轻查询让路
    expect(completionOrder).toEqual(['blocker', 'interactive', 'heavy'])
  })

  it('executes identical in-flight queries once and shares the result', async () => {
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    const before = await workerPort.inspect()

    const results = await Promise.all([
      workerPort.listTasks({ projectId }),
      workerPort.listTasks({ projectId }),
      workerPort.listTasks({ projectId }),
    ])

    const after = await workerPort.inspect()
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    // 3 次同参并发只落 1 次执行;增量 = 那 1 次 + 本次 inspect 自身
    expect(after.executedRequests - before.executedRequests).toBe(2)
  })

  it('does not merge queries with different payloads', async () => {
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    const before = await workerPort.inspect()

    await Promise.all([
      workerPort.listTasks({ projectId }),
      workerPort.listWidgetSessions({ projectId }),
      workerPort.listTaskPage({ projectId, limit: 20 }),
    ])

    const after = await workerPort.inspect()
    // 3 个不同 operation 各跑一次;增量 = 3 + 本次 inspect 自身
    expect(after.executedRequests - before.executedRequests).toBe(4)
  })

  it('skips a request whose deadline passed while it waited and counts the skip', async () => {
    workerPort = await createWorkerQueryPort({ dbPath, allowDiagnostics: true })
    const blocker = workerPort.diagnose({ label: 'blocker', blockMs: 400 }, { priority: 'interactive' })
    await delay(30)

    // 客户端 80ms 就放弃(deadline 兜底同样在 80ms)
    const doomed = workerPort.listTasks({ projectId, deadlineMs: 80 })
    await expect(doomed).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await blocker

    const inspection = await workerPort.inspect()
    // 出队时已过期 → worker 直接回 DEADLINE_EXCEEDED,不占用执行槽(事故里 6ms 查询排 65.5s 的成因)
    expect(inspection.skippedExpiredRequests).toBe(1)
    // 被跳过 = 从未执行:这段时间只有 blocker 与 inspect 真的跑了
    expect(inspection.executedRequests).toBe(2)
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
