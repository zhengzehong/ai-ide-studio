import { describe, expect, test, vi } from 'vitest'
import { createSyncDbOperationObserver } from '../../src/store/db-operation-observer.js'
import { operationDiagnostics } from '../../src/shared/operation-diagnostics.js'

describe('synchronous database operation observer', () => {
  test('separates fast, slow, and failed API database operations', () => {
    operationDiagnostics.clear()
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    }
    const timestamps = [0, 20, 100, 250, 300, 425]
    const observe = createSyncDbOperationObserver({
      slowMs: 100,
      now: () => timestamps.shift() ?? 425,
      logger,
    })

    expect(observe('session.markRead', { sessionId: 'session-a' }, () => 'ok')).toBe('ok')
    expect(observe('timeline.apply', { sessionId: 'session-b' }, () => 2)).toBe(2)
    expect(() => observe('task.report', { taskId: 'task-a' }, () => {
      throw Object.assign(new Error('database is busy'), { code: 'SQLITE_BUSY' })
    })).toThrow('database is busy')

    expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'session.markRead',
      connectionRole: 'api',
      elapsedMs: 20,
      sessionId: 'session-a',
    }), 'synchronous database operation completed')
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'timeline.apply',
      elapsedMs: 150,
      sessionId: 'session-b',
    }), 'slow synchronous database operation completed')
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'task.report',
      elapsedMs: 125,
      taskId: 'task-a',
      sqliteCode: 'SQLITE_BUSY',
      err: expect.any(Error),
    }), 'synchronous database operation failed')
    expect(operationDiagnostics.snapshot().recentSyncOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationModule: 'db-operation',
        operation: 'session.markRead',
        context: { sessionId: 'session-a' },
      }),
      expect.objectContaining({
        operationModule: 'db-operation',
        operation: 'task.report',
        context: { taskId: 'task-a' },
      }),
    ]))
  })
})
