import { sessionManager } from '../../core/sessions.js'
import { projectSessionStatsStore } from '../../store/session-stats.js'
import type { RpcHandlerMap } from './types.js'

export const sessionStatsRpcHandlers: RpcHandlerMap = {
  'sessions.projectStats'(_msg, { sendResult }) {
    sendResult({
      generatedAt: new Date().toISOString(),
      items: projectSessionStatsStore.list((sessionId) => sessionManager.isPromptActive(sessionId)),
    })
  },
}
