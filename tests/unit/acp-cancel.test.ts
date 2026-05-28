import { describe, expect, test, afterEach } from 'vitest'
import { acpHost } from '../../src/acp/host.ts'

describe('acpHost.cancelPrompt', () => {
  afterEach(() => {
    acpHost.agents.delete('agent-cancel-test')
  })

  test('发送 ACP session/cancel，不杀掉整个 Agent 进程', async () => {
    let cancelledParams: unknown = null
    let killed = false
    acpHost.agents.set('agent-cancel-test', {
      agentId: 'agent-cancel-test',
      runtime: 'claude',
      proc: { kill: () => { killed = true } },
      connection: {
        signal: { aborted: false },
        cancel: async (params: unknown) => { cancelledParams = params },
      },
      acpSessions: new Map([['sess-1', 'acp-sess-1']]),
      runtimeSessions: new Map(),
      sessionCapabilities: new Map(),
      state: 'running',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
    } as never)

    await acpHost.cancelPrompt('agent-cancel-test', 'sess-1')

    expect(cancelledParams).toEqual({ sessionId: 'acp-sess-1' })
    expect(killed).toBe(false)
  })
})
