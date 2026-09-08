import { widgetStateStore } from '../../store/widget-state.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { getDb } from '../../store/db.js'
import { events } from '../../core/events.js'
import { getQueryPort } from '../../queries/query-port-provider.js'
import { buildWidgetAgentActivity } from '../../queries/widget-agent-activity-query.js'
import { buildWidgetSessionActivityGroups } from '../../queries/widget-session-activity-query.js'
import {
  localDayStartIso,
  selectLatestWidgetAgentTasks,
  type WidgetAgentTaskCandidateRow,
  type WidgetAgentTodayTask,
} from '../../queries/widget-agent-today-task-query.js'
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

function listWidgetAgentTodayTasks(projectId?: string): WidgetAgentTodayTask[] {
  const rows = getDb().prepare<
    { day_start: string; project_id: string | null },
    WidgetAgentTaskCandidateRow
  >(`
    SELECT *
    FROM (
      SELECT
        t.assigned_agent_id AS agent_id,
        t.id AS task_id,
        t.title AS task_title,
        t.status AS task_status,
        t.project_id,
        COALESCE(
          (
            SELECT MAX(te.created_at)
            FROM task_events te
            WHERE te.task_id = t.id
              AND te.type = 'assigned_agent'
              AND json_extract(te.payload_json, '$.to_agent_id') = t.assigned_agent_id
          ),
          t.created_at
        ) AS assigned_at,
        t.rowid AS relation_order,
        COALESCE(
          (
            SELECT ts.session_id
            FROM task_steps ts
            JOIN sessions step_session ON step_session.id = ts.session_id
            WHERE ts.task_id = t.id
              AND ts.assignee_agent_id = t.assigned_agent_id
              AND step_session.deleted_at IS NULL
              AND step_session.archived_at IS NULL
            ORDER BY ts.created_at DESC, ts.id DESC
            LIMIT 1
          ),
          (
            SELECT s.id
            FROM sessions s
            WHERE s.task_id = t.id
              AND s.agent_id = t.assigned_agent_id
              AND s.deleted_at IS NULL
              AND s.archived_at IS NULL
            ORDER BY s.started_at DESC, s.id DESC
            LIMIT 1
          )
        ) AS session_id
      FROM tasks t
      WHERE t.assigned_agent_id IS NOT NULL

      UNION ALL

      SELECT
        ts.assignee_agent_id AS agent_id,
        t.id AS task_id,
        t.title AS task_title,
        t.status AS task_status,
        t.project_id,
        COALESCE(
          (
            SELECT MAX(te.created_at)
            FROM task_events te
            WHERE te.task_id = t.id
              AND te.type = 'step_assigned'
              AND json_extract(te.payload_json, '$.stepId') = ts.id
              AND json_extract(te.payload_json, '$.toAssignee') = ts.assignee_agent_id
          ),
          ts.created_at
        ) AS assigned_at,
        ts.rowid AS relation_order,
        step_session.id AS session_id
      FROM task_steps ts
      JOIN tasks t ON t.id = ts.task_id
      LEFT JOIN sessions step_session
        ON step_session.id = ts.session_id
        AND step_session.deleted_at IS NULL
        AND step_session.archived_at IS NULL
      WHERE ts.assignee_agent_id IS NOT NULL
    ) candidates
    WHERE candidates.assigned_at >= @day_start
      AND (@project_id IS NULL OR candidates.project_id = @project_id)
    ORDER BY candidates.agent_id ASC, candidates.assigned_at DESC, candidates.relation_order DESC
  `).all({
    day_start: localDayStartIso(new Date()),
    project_id: projectId ?? null,
  })
  return selectLatestWidgetAgentTasks(rows)
}

export const widgetRpcHandlers: RpcHandlerMap = {
  async 'widget.sessionActivity.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const sessions = await getQueryPort().listWidgetSessions({ projectId })
    sendResult(buildWidgetSessionActivityGroups(sessions))
  },

  async 'widget.agentActivity.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const sessions = await getQueryPort().listWidgetSessions({ projectId })
    sendResult(buildWidgetAgentActivity(sessions, listWidgetAgentTodayTasks(projectId)))
  },

  async 'widget.sessions.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'
    const sessions = await getQueryPort().listWidgetSessions({ projectId })

    if (filter === 'active') {
      sendResult(sessions.filter((session) => session.activityState === 'running' || session.unread))
    } else if (filter === 'recent') {
      sendResult(sessions
        .filter((session) => session.activityState === 'running' || session.completedAt)
        .slice(0, 20))
    } else {
      sendResult(sessions)
    }
  },

  'widget.sessions.markRead'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('sessionId 不能为空')
    if (!sessionStore.get(sessionId)) return sendError('会话不存在')
    widgetStateStore.markRead(sessionId)
    sessionStore.markRead(sessionId)
    events.emit('session:changed', { sessionId, data: { last_read_at: new Date().toISOString() } })
    sendResult({ ok: true })
  },

  async 'widget.agents.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'

    const agents = agentStore.list(projectId || undefined)
    const sessionRowsById = new Map(
      (await getQueryPort().listWidgetSessions({ projectId })).map((session) => [session.sessionId, session]),
    )

    const result = agents.flatMap((agent) => {
      const sessions = sessionStore.list(agent.id).filter((session) => sessionRowsById.has(session.id))
      if (sessions.length === 0) return []
      const latestSession = sessions[sessions.length - 1]
      const isRunning = sessions.some((session) => sessionRowsById.get(session.id)?.activityState === 'running')
      const unreadSession = latestSession ? sessionRowsById.get(latestSession.id) : undefined
      const isUnread = unreadSession?.unread ?? false

      return [{
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
      }]
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
