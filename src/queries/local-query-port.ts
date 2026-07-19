import type { QueryPort } from '../ports/query-port.js'
import { sessionManager } from '../core/sessions.js'
import { createDatabaseQueryPort } from './database-query-port.js'

export interface LocalQueryPortOptions {
  isPromptActive?: (sessionId: string) => boolean
}

export function createLocalQueryPort(options: LocalQueryPortOptions = {}): QueryPort {
  const isPromptActive = options.isPromptActive ?? ((sessionId: string) => sessionManager.isPromptActive(sessionId))
  return createDatabaseQueryPort({ isPromptActive })
}

export const localQueryPort: QueryPort = createLocalQueryPort()
