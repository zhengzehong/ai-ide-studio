import { createChildLogger } from '../core/logger.js'
import {
  trackSyncOperation,
  type OperationContext,
} from '../shared/operation-diagnostics.js'

interface OperationLogger {
  debug(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

export interface SyncDbOperationObserverOptions {
  slowMs?: number
  now?: () => number
  logger?: OperationLogger
}

export type SyncDbOperationObserver = <T>(
  operation: string,
  context: Record<string, unknown>,
  execute: () => T,
) => T

const DEFAULT_SLOW_MS = 100
const log = createChildLogger('db-operation')

export function createSyncDbOperationObserver(
  options: SyncDbOperationObserverOptions = {},
): SyncDbOperationObserver {
  const slowMs = options.slowMs ?? DEFAULT_SLOW_MS
  const now = options.now ?? performance.now.bind(performance)
  const logger = options.logger ?? log

  return <T>(operation: string, context: Record<string, unknown>, execute: () => T): T => {
    return trackSyncOperation(
      {
        operationModule: 'db-operation',
        operation,
        context: safeOperationContext(context),
      },
      () => {
        const startedAt = now()
        try {
          const result = execute()
          const elapsedMs = roundedElapsed(now() - startedAt)
          const diagnostic = { ...context, operation, connectionRole: 'api', elapsedMs }
          if (elapsedMs >= slowMs) {
            logger.warn(diagnostic, 'slow synchronous database operation completed')
          } else {
            logger.debug(diagnostic, 'synchronous database operation completed')
          }
          return result
        } catch (err) {
          logger.warn({
            ...context,
            err,
            operation,
            connectionRole: 'api',
            elapsedMs: roundedElapsed(now() - startedAt),
            sqliteCode: sqliteErrorCode(err),
          }, 'synchronous database operation failed')
          throw err
        }
      }
    )
  }
}

export const observeSyncDbOperation = createSyncDbOperationObserver()

function roundedElapsed(value: number): number {
  return Number(Math.max(0, value).toFixed(2))
}

function sqliteErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as Record<string, unknown>).code
  return typeof code === 'string' && code.startsWith('SQLITE_') ? code : undefined
}

function safeOperationContext(context: Record<string, unknown>): OperationContext {
  const safe: OperationContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      safe[key] = value as OperationContext[string]
    }
  }
  return safe
}
