import type { ActivePromptDiagnostic } from '../app-handle.js'
import { createChildLogger } from '../shared/logger.js'

const log = createChildLogger('edge-api-entry')

export interface ApiFatalEventSource {
  on(event: 'uncaughtExceptionMonitor', listener: NodeJS.UncaughtExceptionListener): unknown
  off(event: 'uncaughtExceptionMonitor', listener: NodeJS.UncaughtExceptionListener): unknown
}

interface ApiFatalDiagnosticsOptions {
  eventSource?: ApiFatalEventSource
  listActiveTurns: () => ActivePromptDiagnostic[]
  writeFatal?: (context: Record<string, unknown>, message: string) => void
  flush?: () => void
}

export function installApiFatalDiagnostics(options: ApiFatalDiagnosticsOptions): () => void {
  const eventSource = options.eventSource ?? process
  const writeFatal = options.writeFatal ?? ((context, message) => log.fatal(context, message))
  const flush = options.flush ?? (() => log.flush())
  const listener: NodeJS.UncaughtExceptionListener = (error, origin) => {
    try {
      const activeTurns = options.listActiveTurns().map(toFatalTurnContext)
      writeFatal(
        {
          err: error,
          origin,
          activeTurnCount: activeTurns.length,
          activeTurns,
        },
        'API child uncaught exception',
      )
      flush()
    } catch {
      // Fatal diagnostics must never replace or suppress the original process failure.
    }
  }
  eventSource.on('uncaughtExceptionMonitor', listener)
  return () => { eventSource.off('uncaughtExceptionMonitor', listener) }
}

function toFatalTurnContext(state: ActivePromptDiagnostic): Record<string, unknown> {
  return {
    sessionId: state.sessionId,
    agentId: state.agentId,
    projectId: state.projectId,
    turnId: state.turnId,
    startedAt: new Date(state.startedAt).toISOString(),
    activeForMs: Date.now() - state.startedAt,
    lastProgress: state.lastProgress,
    lastProgressAt: new Date(state.lastProgressAt).toISOString(),
  }
}
