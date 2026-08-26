import { threadId } from 'node:worker_threads'
import { createDatabaseQueryPort } from '../../queries/database-query-port.js'
import { getDatabaseMode, getDb } from '../../store/db.js'
import { InvalidTaskCursorError } from '../../store/task-page.js'

export interface QueryWorkerInspection {
  mode: 'readonly' | 'readwrite' | null
  queryOnly: boolean
  threadId: number
}

export interface QueryWorkerDiagnosticInput {
  label?: string
  blockMs?: number
  attemptWrite?: boolean
}

export interface QueryWorkerDiagnosticResult extends QueryWorkerInspection {
  label?: string
}

export interface QueryWorkerOperationOptions {
  allowDiagnostics: boolean
}

export async function executeQueryOperation(
  operation: string,
  payload: unknown,
  options: QueryWorkerOperationOptions,
): Promise<unknown> {
  const queryPort = createDatabaseQueryPort()
  switch (operation) {
    case 'tasks.list':
      return queryPort.listTasks(asObject(payload))
    case 'tasks.page':
      try {
        return await queryPort.listTaskPage(asObject(payload))
      } catch (error) {
        if (error instanceof InvalidTaskCursorError) {
          throw new QueryOperationError('BAD_REQUEST', error.message)
        }
        throw error
      }
    case 'sessions.list':
      return queryPort.listSessions(asObject(payload))
    case 'sessions.messages':
      return queryPort.listSessionMessages(requireSessionId(payload))
    case 'sessions.events':
      return queryPort.listSessionEvents(requireSessionId(payload))
    case 'sessions.recovery':
      return queryPort.getSessionRecovery(requireSessionId(payload))
    case 'worker.inspect':
      return inspectQueryWorker()
    case 'worker.diagnose':
      if (!options.allowDiagnostics) throw new QueryOperationError('BAD_REQUEST', 'Diagnostics are disabled')
      return diagnoseQueryWorker(payload)
    default:
      throw new QueryOperationError('BAD_REQUEST', `Unknown query operation: ${operation}`)
  }
}

export class QueryOperationError extends Error {
  readonly code: 'BAD_REQUEST' | 'SQLITE_ERROR'

  constructor(code: 'BAD_REQUEST' | 'SQLITE_ERROR', message: string) {
    super(message)
    this.name = 'QueryOperationError'
    this.code = code
  }
}

function inspectQueryWorker(): QueryWorkerInspection {
  const queryOnly = getDb().pragma('query_only', { simple: true })
  return {
    mode: getDatabaseMode(),
    queryOnly: queryOnly === 1,
    threadId,
  }
}

function diagnoseQueryWorker(payload: unknown): QueryWorkerDiagnosticResult {
  const input = asObject(payload) as QueryWorkerDiagnosticInput
  if (input.blockMs != null) blockFor(input.blockMs)
  if (input.attemptWrite) {
    try {
      getDb().prepare('CREATE TABLE query_worker_write_probe (id TEXT)').run()
    } catch (error) {
      throw new QueryOperationError('SQLITE_ERROR', errorMessage(error))
    }
  }
  return { ...inspectQueryWorker(), label: input.label }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QueryOperationError('BAD_REQUEST', 'Query payload must be an object')
  }
  return value as Record<string, unknown>
}

function requireSessionId(value: unknown): Record<string, unknown> & { sessionId: string } {
  const payload = asObject(value)
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) {
    throw new QueryOperationError('BAD_REQUEST', 'sessionId is required')
  }
  return payload as Record<string, unknown> & { sessionId: string }
}

function blockFor(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 5_000) {
    throw new QueryOperationError('BAD_REQUEST', 'blockMs must be between 0 and 5000')
  }
  const until = performance.now() + value
  while (performance.now() < until) {
    // Deliberately occupy only the diagnostic worker thread.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
