import { describe, expect, test, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.ts'
import { events, type AppEvents } from '../../src/core/events.ts'
import { initDatabase, closeDatabase } from '../../src/store/db.ts'

let tmp = ''

function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('acpHost lifecycle state', () => {
  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-lifecycle-'))
    initDatabase(resolve(tmp, 'test.sqlite'))
  })

  afterEach(() => {
    closeDatabase()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
    acpHost.agents.delete('agent-lifecycle-test')
    vi.restoreAllMocks()
  })

  test('同一 Session 并发 prompt 会被拒绝，不阻塞同 Agent 的其他 Session', async () => {
    const firstTurn = makeDeferred<{ stopReason: string }>()
    const secondTurn = makeDeferred<{ stopReason: string }>()
    const started: string[] = []

    acpHost.agents.set('agent-lifecycle-test', {
      agentId: 'agent-lifecycle-test',
      runtime: 'mock',
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        prompt: async (params: { sessionId: string }) => {
          started.push(params.sessionId)
          return params.sessionId === 'acp-sess-1' ? firstTurn.promise : secondTurn.promise
        },
      },
      acpSessions: new Map([['sess-1', 'acp-sess-1'], ['sess-2', 'acp-sess-2']]),
      runtimeSessions: new Map(),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
    } as never)

    const firstPrompt = acpHost.prompt('agent-lifecycle-test', 'sess-1', 'hello')
    await expect(acpHost.prompt('agent-lifecycle-test', 'sess-1', 'again')).rejects.toThrow('当前会话正在生成中')

    const otherPrompt = acpHost.prompt('agent-lifecycle-test', 'sess-2', 'parallel')
    secondTurn.resolve({ stopReason: 'end_turn' })
    await otherPrompt

    firstTurn.resolve({ stopReason: 'end_turn' })
    await firstPrompt

    expect(started).toEqual(['acp-sess-1', 'acp-sess-2'])
  })

  test('silent resume does not emit lifecycle updates', async () => {
    const lifecycleUpdates: string[] = []
    const handler = (ev: AppEvents['session:update']) => {
      if (ev.sessionId !== 'sess-resume') return
      if (typeof ev.data.eventType === 'string') lifecycleUpdates.push(ev.data.eventType)
    }
    events.on('session:update', handler)
    vi.spyOn(acpHost, 'startAgent').mockResolvedValue(undefined)

    acpHost.agents.set('agent-lifecycle-test', {
      agentId: 'agent-lifecycle-test',
      runtime: 'mock',
      proc: { kill: () => undefined },
      connection: {
        signal: { aborted: false },
        resumeSession: async () => ({}),
      },
      acpSessions: new Map(),
      runtimeSessions: new Map(),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      agentCapabilities: { sessionCapabilities: { resume: true } },
    } as never)

    try {
      await acpHost.ensureSession('agent-lifecycle-test', 'sess-resume', 'acp-existing', { emitLifecycle: false })
    } finally {
      events.off('session:update', handler)
    }

    expect(lifecycleUpdates).toEqual([])
  })

})
