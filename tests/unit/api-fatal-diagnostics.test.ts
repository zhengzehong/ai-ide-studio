import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { installApiFatalDiagnostics, type ApiFatalEventSource } from '../../src/edge/api-fatal-diagnostics.js'

describe('API fatal diagnostics', () => {
  test('logs active turns without installing a recovery handler', () => {
    const eventSource = new EventEmitter()
    const writeFatal = vi.fn()
    const flush = vi.fn()
    const startedAt = Date.now() - 2_000
    const lastProgressAt = Date.now() - 500
    const uninstall = installApiFatalDiagnostics({
      eventSource: eventSource as ApiFatalEventSource,
      listActiveTurns: () => [{
        sessionId: 'session-a',
        agentId: 'agent-a',
        projectId: 'project-a',
        turnId: 'turn-a',
        startedAt,
        lastProgressAt,
        lastProgress: 'tool.update:completed',
      }],
      writeFatal,
      flush,
    })
    const error = new Error('fatal rejection')

    eventSource.emit('uncaughtExceptionMonitor', error, 'unhandledRejection')

    expect(writeFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        origin: 'unhandledRejection',
        activeTurnCount: 1,
        activeTurns: [expect.objectContaining({
          sessionId: 'session-a',
          agentId: 'agent-a',
          projectId: 'project-a',
          turnId: 'turn-a',
          lastProgress: 'tool.update:completed',
        })],
      }),
      'API child uncaught exception',
    )
    expect(flush).toHaveBeenCalledOnce()
    expect(eventSource.listenerCount('uncaughtException')).toBe(0)
    expect(eventSource.listenerCount('unhandledRejection')).toBe(0)

    uninstall()
    expect(eventSource.listenerCount('uncaughtExceptionMonitor')).toBe(0)
  })
})
