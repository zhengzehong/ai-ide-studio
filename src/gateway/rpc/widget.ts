import { widgetStateStore } from '../../store/widget-state.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { getDb } from '../../store/db.js'
import { sessionManager } from '../../core/sessions.js'
import { events } from '../../core/events.js'
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

interface WidgetSessionRow {
  session_id: string
  agent_id: string
  agent_name: string
  agent_icon: string | null
  project_id: string | null
  project_name: string | null
  task_id: string | null
  task_title: string | null
  task_status: string | null
  task_created_at: string | null
  session_title: string | null
  session_status: string
  stage: string
  started_at: string
  closed_at: string | null
  updated_at: string | null
  last_message_at: string | null
  last_read_at: string | null
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
    WITH session_links AS (
      SELECT
        s.*,
        COALESCE(
          s.task_id,
          (
            SELECT ts.task_id
            FROM task_steps ts
            WHERE ts.session_id = s.id
            ORDER BY ts.updated_at DESC, ts.id DESC
            LIMIT 1
          )
        ) AS linked_task_id
      FROM sessions s
    )
    SELECT
      s.id AS session_id,
      s.agent_id,
      a.name AS agent_name,
      a.icon AS agent_icon,
      s.project_id,
      p.name AS project_name,
      s.linked_task_id AS task_id,
      t.title AS task_title,
      t.status AS task_status,
      t.created_at AS task_created_at,
      s.title AS session_title,
      s.status AS session_status,
      s.stage,
      s.started_at,
      s.closed_at,
      s.updated_at,
      s.last_message_at,
      s.last_read_at,
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
    FROM session_links s
    JOIN agents a ON a.id = s.agent_id
    LEFT JOIN projects p ON p.id = s.project_id
    LEFT JOIN tasks t ON t.id = s.linked_task_id
    WHERE s.deleted_at IS NULL
      AND s.archived_at IS NULL
      AND s.purpose = 'conversation'
      ${projectId ? 'AND s.project_id = ?' : ''}
    ORDER BY COALESCE(s.last_message_at, s.updated_at, s.started_at) DESC
  `
  return projectId
    ? getDb().prepare<[string], Omit<WidgetSessionRow, 'activity_state'>>(sql).all(projectId)
      .map((row) => ({ ...row, activity_state: runtimeStateBySessionId.get(row.session_id) ?? 'idle' }))
    : getDb().prepare<[], Omit<WidgetSessionRow, 'activity_state'>>(sql).all()
      .map((row) => ({ ...row, activity_state: runtimeStateBySessionId.get(row.session_id) ?? 'idle' }))
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

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function isWidgetSessionUnread(row: WidgetSessionRow): boolean {
  if (!row.last_message_at || !row.last_read_at) return false
  return Date.parse(row.last_message_at) > Date.parse(row.last_read_at)
}

function toWidgetSession(row: WidgetSessionRow) {
  const completedAt = latestTimestamp(row.latest_agent_message_at, row.latest_done_event_at)
  const lastMessageAt = row.last_message_at ?? completedAt
  const taskIsToday = row.task_created_at
    ? Date.parse(row.task_created_at) >= Date.parse(localDayStartIso(new Date()))
    : false
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentIcon: row.agent_icon,
    projectId: row.project_id,
    projectName: row.project_name,
    taskId: taskIsToday ? row.task_id : null,
    taskTitle: taskIsToday ? row.task_title : null,
    taskStatus: taskIsToday ? row.task_status : null,
    sessionTitle: row.session_title,
    status: row.session_status,
    activityState: row.activity_state,
    stage: row.stage,
    unread: isWidgetSessionUnread(row),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    lastMessageAt,
    completedAt,
    closedAt: row.closed_at,
  }
}

export const widgetRpcHandlers: RpcHandlerMap = {
  'widget.sessionActivity.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const sessions = listWidgetSessions(projectId).map(toWidgetSession)
    sendResult(buildWidgetSessionActivityGroups(sessions))
  },

  'widget.agentActivity.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const sessions = listWidgetSessions(projectId).map(toWidgetSession)
    sendResult(buildWidgetAgentActivity(sessions, listWidgetAgentTodayTasks(projectId)))
  },

  'widget.sessions.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'
    const sessions = listWidgetSessions(projectId)
      .map(toWidgetSession)

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

  'widget.agents.list'(msg, { sendResult }) {
    const projectId = msg.projectId as string | undefined
    const filter = (msg.filter as string) || 'active'

    const agents = agentStore.list(projectId || undefined)
    const sessionRowsById = new Map(listWidgetSessions(projectId).map((session) => [session.session_id, session]))

    const result = agents.flatMap((agent) => {
      const sessions = sessionStore.list(agent.id).filter((session) => session.purpose === 'conversation')
      if (sessions.length === 0) return []
      const latestSession = sessions[sessions.length - 1]
      const isRunning = sessions.some((session) => sessionRowsById.get(session.id)?.activity_state === 'running')
      const unreadSession = latestSession ? sessionRowsById.get(latestSession.id) : undefined
      const isUnread = unreadSession ? isWidgetSessionUnread(unreadSession) : false

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
