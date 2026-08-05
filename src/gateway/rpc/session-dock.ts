import { events } from '../../core/events.js'
import { createChildLogger } from '../../core/logger.js'
import { sessionManager } from '../../core/sessions.js'
import {
  listGlobalSessionDockItems,
  searchGlobalSessionDockCandidates,
} from '../../queries/global-session-dock-query.js'
import { globalSessionDockStore } from '../../store/global-session-dock.js'
import { sessionStore } from '../../store/sessions.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc-session-dock')

export const sessionDockRpcHandlers: RpcHandlerMap = {
  'sessionDock.list'(_msg, { state, sendResult }) {
    requireOwner(state.authMode)
    sendResult(listItems())
  },

  'sessionDock.search'(msg, { state, sendResult }) {
    requireOwner(state.authMode)
    sendResult(searchGlobalSessionDockCandidates(
      typeof msg.query === 'string' ? msg.query : '',
      typeof msg.limit === 'number' ? msg.limit : 30,
      (sessionId) => sessionManager.isPromptActive(sessionId),
    ))
  },

  'sessionDock.add'(msg, { state, sendResult }) {
    requireOwner(state.authMode)
    const sessionId = requireSessionId(msg.sessionId)
    requireDockableSession(sessionId)
    const existing = globalSessionDockStore.get(sessionId)
    globalSessionDockStore.add(sessionId)
    if (!existing) {
      events.emit('session-dock:update', { action: 'added', sessionId })
      log.info({ sessionId }, 'Session added to global dock')
    }
    sendResult(listItems().find((item) => item.sessionId === sessionId))
  },

  'sessionDock.remove'(msg, { state, sendResult }) {
    requireOwner(state.authMode)
    const sessionId = requireSessionId(msg.sessionId)
    const removed = globalSessionDockStore.remove(sessionId)
    if (removed) {
      events.emit('session-dock:update', { action: 'removed', sessionId })
      log.info({ sessionId }, 'Session removed from global dock')
    }
    sendResult({ removed })
  },

  'sessionDock.reorder'(msg, { state, sendResult }) {
    requireOwner(state.authMode)
    globalSessionDockStore.pruneUndockable()
    const sessionIds = Array.isArray(msg.sessionIds)
      ? msg.sessionIds.filter((item): item is string => typeof item === 'string')
      : []
    globalSessionDockStore.reorder(sessionIds)
    events.emit('session-dock:update', { action: 'reordered' })
    sendResult(listItems())
  },
}

function listItems() {
  globalSessionDockStore.pruneUndockable()
  return listGlobalSessionDockItems((sessionId) => sessionManager.isPromptActive(sessionId))
}

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问全局会话坞')
}

function requireSessionId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('sessionId 不能为空')
  return value
}

function requireDockableSession(sessionId: string): void {
  const session = sessionStore.get(sessionId)
  if (!session || session.deleted_at || session.archived_at) throw new Error('会话不存在或已归档')
  if (!session.project_id) throw new Error('全局会话坞只支持项目会话')
  if (session.is_template === 1 || session.purpose !== 'conversation') {
    throw new Error('当前会话不能加入全局会话坞')
  }
}
