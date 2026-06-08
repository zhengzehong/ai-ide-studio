import { widgetStateStore } from '../../store/widget-state.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { getDb } from '../../store/db.js'
import { sessionManager } from '../../core/sessions.js'
import type { RpcHandlerMap } from './types.js'

interface ProjectNameRow {
  id: string
  name: string
}

interface WidgetSessionRow {
  session_id: string
  agent_id: string
  agent_name: string
  agent_icon: string | null
  project_id: string | null
  project_name: string | null
  task_id: string | null
  task_title: string | null
  session_title: string | null
  session_status: string
  stage: string
  started_at: string
  closed_at: string | null
  updated_at: string | null
  last_message_at: string | null
  latest_agent_message_at: string | null
  latest_done_event_at: string | null
  activity_state: 'running' | 'idle'
}

function getProjectName(projectId: string | null): string | null {
  if (!projectId) return null
  const row = getDb()
    .prepare<[string], ProjectNameRow>('SELECT name FROM projects WHERE id = ?')
    .get(projectId)
  return row?.name ?? null
}

function listWidgetSessions(projectId?: string): WidgetSessionRow[] {
  const runtimeStateBySessionId = new Map(
    sessionStore
      .listWithRuntimeState(undefined, projectId, (sessionId) => sessionManager.isPromptActive(sessionId))
      .map((session) => [session.id, session.activity_state]),
  )
  const sql = `
    SELECT
      s.id AS session_id,
      s.agent_id,
      a.name AS agent_name,
      a.icon AS agent_icon,
      s.project_id,
      p.name AS project_name,
      s.task_id,
      t.title AS task_title,
      s.title AS session_title,
      s.status AS session_status,
      s.stage,
      s.started_at,
      s.closed_at,
      s.updated_at,
      s.last_message_at,
      (
        SELECT MAX(m.timestamp)
        FROM messages m
        WHERE m.session_id = s.id AND m.role = 'agent' AND m.status != 'running'
      ) AS latest_agent_message_at,
      (
        SELECT MAX(e.created_at)
        FROM session_events e
        WHERE e.session_id = s.id AND e.type = 'message.done'
      ) AS latest_done_event_at
    FROM sessions s
    JOIN agents a ON a.id = s.agent_id
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN tasks t ON t.id = s.task_id
    WHERE s.deleted_at IS NULL
      AND s.archived_at IS NULL
      ${projectId ? 'AND s.project_id = ?' : ''}
    ORDER BY COALESCE(s.last_message_at, s.updated_at, s.started_at) DESC
  `
  return projectId
    ? getDb().prepare<[string], Omit<WidgetSessionRow, 'activity_state'>>(sql).all(projectId)
      .map((row) => ({ ...row, activity_state: runtimeStateBySessionId.get(row.session_id) ?? 'idle' }))
    : getDb().prepare<[], Omit<WidgetSessionRow, 'activity_state'>>(sql).all()
      .map((row) => ({ ...row, activity_state: runtimeStateBySessionId.get(row.session_id) ?? 'idle' }))
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function isWidgetSessionUnread(row: WidgetSessionRow): boolean {
  const completedAt = latestTimestamp(row.latest_agent_message_at, row.latest_done_event_at)
  if (!completedAt) return false
  const readAt = widgetStateStore.getReadAt(row.session_id)
  return !readAt || completedAt > readAt
}

function toWidgetSession(row: WidgetSessionRow) {
  const completedAt = latestTimestamp(row.latest_agent_message_at, row.latest_done_event_at)
  const lastMessageAt = row.last_message_at ?? completedAt
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentIcon: row.agent_icon,
    projectId: row.project_id,
    projectName: row.project_name,
    taskId: row.task_id,
    taskTitle: row.task_title,
    sessionTitle: row.session_title,
    status: row.session_status,
    activityState: row.activity_state,
    stage: row.stage,
    unread: isWidgetSessionUnread(row),
    startedAt: row.started_at,
    lastMessageAt,
    completedAt,
    closedAt: row.closed_at,
  }
}

export const widgetRpcHandlers: RpcHandlerMap = {
  'widget.sessions.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'
    const sessions = listWidgetSessions(projectId)
      .map(toWidgetSession)

    if (filter === 'active') {
      sendResult(sessions.filter((session) => session.activityState === 'running' || session.unread))
    } else {
      sendResult(sessions)
    }
  },

  'widget.sessions.markRead'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('sessionId 不能为空')
    if (!sessionStore.get(sessionId)) return sendError('会话不存在')
    widgetStateStore.markRead(sessionId)
    sendResult({ ok: true })
  },

  'widget.agents.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'

    const agents = agentStore.list(projectId || undefined)
    const sessionRowsById = new Map(listWidgetSessions(projectId).map((session) => [session.session_id, session]))

    const result = agents.map((agent) => {
      const sessions = sessionStore.list(agent.id)
      const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null
      const isRunning = agent.status === 'running'
      const unreadSession = latestSession ? sessionRowsById.get(latestSession.id) : undefined
      const isUnread = unreadSession ? isWidgetSessionUnread(unreadSession) : false

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
    if (!sessionStore.get(sessionId)) return sendError('会话不存在')
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
