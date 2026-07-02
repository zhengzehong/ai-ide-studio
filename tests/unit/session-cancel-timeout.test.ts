import { describe, expect, test } from 'vitest'
import { forceCancelTimedOutTurn } from '../../src/gateway/rpc/sessions.ts'
import type { AgentConnection } from '../../src/acp/host-types.ts'

function createConnection(activeTurnKey: number | undefined, withReject = false): AgentConnection {
  let capturedReject: ((err: Error) => void) | undefined
  if (withReject) {
    capturedReject = (_err: Error) => { /* sentinel, no-op for type stability */ }
  }
  return {
    agentId: 'agent-cancel-timeout',
    runtime: 'mock',
    proc: {} as AgentConnection['proc'],
    connection: {} as AgentConnection['connection'],
    acpSessions: new Map([['sess-1', 'acp-sess-1']]),
    runtimeSessions: new Map([
      [
        'sess-1',
        {
          ourSessionId: 'sess-1',
          acpSessionId: 'acp-sess-1',
          state: 'connected',
          lastUsedAt: Date.now(),
          activeTurnCount: 1,
          activeTurnKey,
          nextTurnKey: activeTurnKey ?? 0,
          activeTurnReject: capturedReject,
        },
      ],
    ]),
    sessionCapabilities: new Map(),
    state: 'running',
    lastUsedAt: Date.now(),
    activeTurnCount: 1,
  } as unknown as AgentConnection
}

describe('session cancel timeout', () => {
  test('does not force done when a newer turn is active', () => {
    const conn = createConnection(2)

    const forced = forceCancelTimedOutTurn(conn, 'sess-1', 1)

    expect(forced).toBe(false)
    expect(conn.activeTurnCount).toBe(1)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnCount).toBe(1)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnKey).toBe(2)
  })

  test('forces done only for the same active turn', () => {
    const conn = createConnection(1)

    const forced = forceCancelTimedOutTurn(conn, 'sess-1', 1)

    expect(forced).toBe(true)
    expect(conn.activeTurnCount).toBe(0)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnCount).toBe(0)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnKey).toBeUndefined()
  })

  test('does not force done without a cancelled turn identity', () => {
    const conn = createConnection(1)

    const forced = forceCancelTimedOutTurn(conn, 'sess-1', undefined)

    expect(forced).toBe(false)
    expect(conn.activeTurnCount).toBe(1)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnCount).toBe(1)
  })

  test('clears activeTurnReject when forcing done', () => {
    const conn = createConnection(1, true)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnReject).toBeDefined()

    const forced = forceCancelTimedOutTurn(conn, 'sess-1', 1)

    expect(forced).toBe(true)
    expect(conn.runtimeSessions.get('sess-1')?.activeTurnReject).toBeUndefined()
  })
})
