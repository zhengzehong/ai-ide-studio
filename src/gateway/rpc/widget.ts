import { widgetStateStore } from '../../store/widget-state.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { getDb } from '../../store/db.js'
import type { RpcHandlerMap } from './types.js'

interface ProjectNameRow {
  id: string
  name: string
}

function getProjectName(projectId: string | null): string | null {
  if (!projectId) return null
  const row = getDb()
    .prepare<[string], ProjectNameRow>('SELECT name FROM projects WHERE id = ?')
    .get(projectId)
  return row?.name ?? null
}

export const widgetRpcHandlers: RpcHandlerMap = {
  'widget.agents.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'

    const agents = agentStore.list(projectId || undefined)

    const result = agents.map((agent) => {
      const sessions = sessionStore.list(agent.id)
      const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null
      const isRunning = agent.status === 'running'
      const isCompleted = latestSession?.status === 'completed' || latestSession?.status === 'closed'
      const isUnread = isCompleted && latestSession ? !widgetStateStore.isRead(latestSession.id) : false

      return {
        agentId: agent.id,
        agentName: agent.name,
        agentIcon: agent.icon,
        projectId: agent.project_id,
        projectName: getProjectName(agent.project_id),
        sessionId: latestSession?.id ?? null,
        sessionTitle: latestSession?.title ?? null,
        status: agent.status,
        stage: latestSession?.stage ?? '',
        isRunning,
        isUnread,
        startedAt: latestSession?.started_at ?? null,
        closedAt: latestSession?.closed_at ?? null,
      }
    })

    if (filter === 'active') {
      sendResult(result.filter((a) => a.isRunning || a.isUnread))
    } else {
      sendResult(result)
    }
  },

  'widget.markRead'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('sessionId 不能为空')
    widgetStateStore.markRead(sessionId)
    sendResult({ ok: true })
  },

  'widget.preferences.get'(msg, { sendResult }) {
    const key = msg.key as string | undefined
    if (key) {
      const value = widgetStateStore.getPreference(key)
      sendResult({ key, value: value ?? null })
    } else {
      sendResult(widgetStateStore.getAllPreferences())
    }
  },

  'widget.preferences.set'(msg, { sendResult, sendError }) {
    const key = msg.key as string
    const value = msg.value as string
    if (!key) return sendError('key 不能为空')
    if (value === undefined || value === null) {
      widgetStateStore.deletePreference(key)
    } else {
      widgetStateStore.setPreference(key, value)
    }
    sendResult({ ok: true })
  },
}
