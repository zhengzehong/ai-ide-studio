import { describe, expect, test, afterEach } from 'vitest'
import { acpHost } from '../../src/acp/host.ts'

function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('acpHost lifecycle state', () => {
  afterEach(() => {
    acpHost.agents.delete('agent-lifecycle-test')
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
})
