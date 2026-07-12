import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { parseTaskEventPayload, taskEventStore } from './task-events.js'

export { taskAttachmentStore, type TaskAttachmentRow } from './task-attachments.js'
export { extractReportPreview, taskEventStore, type AppendTaskEventInput, type TaskEventRow } from './task-events.js'

export interface TaskRow {
  id: string
  title: string
  description: string | null
  source: string
  status: string
  stage: string
  assigned_agent_id: string | null
  created_at: string
  completed_at: string | null
  project_id: string | null
  team_id: string | null
  assignee_member_id: string | null
  rule_id: string | null
  agent_report_status: string | null
  execution_mode_id: string | null
  initiator_agent_id: string | null
  initiator_session_id: string | null
}

export interface CreateTaskInput {
  title: string
  description: string
  source?: string
  projectId?: string
  initiatorAgentId?: string
  initiatorSessionId?: string
}

interface CreateStoredTaskInput extends CreateTaskInput {
  teamId?: string
  assigneeMemberId?: string
  ruleId?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: string
  stage?: string
  assignAgentId?: string | null
  assigneeMemberId?: string | null
}

export const taskStore = {
  create(input: CreateStoredTaskInput): TaskRow {
    const task: TaskRow = {
      id: `task-${randomUUID().slice(0, 8)}`,
      title: input.title,
      description: input.description,
      source: input.source || 'human',
      status: 'draft',
      stage: '',
      assigned_agent_id: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      project_id: input.projectId ?? null,
      team_id: input.teamId ?? null,
      assignee_member_id: input.assigneeMemberId ?? null,
      rule_id: input.ruleId ?? null,
      agent_report_status: null,
      execution_mode_id: null,
      initiator_agent_id: input.initiatorAgentId ?? null,
      initiator_session_id: input.initiatorSessionId ?? null,
    }
    getDb()
      .prepare(
        `
      INSERT INTO tasks (
        id, title, description, source, status, stage, assigned_agent_id,
        created_at, completed_at, project_id, team_id, assignee_member_id, rule_id,
        agent_report_status, execution_mode_id, initiator_agent_id, initiator_session_id
      )
      VALUES (
        @id, @title, @description, @source, @status, @stage, @assigned_agent_id,
        @created_at, @completed_at, @project_id, @team_id, @assignee_member_id, @rule_id,
        @agent_report_status, @execution_mode_id, @initiator_agent_id, @initiator_session_id
      )
    `,
      )
      .run(task)
    taskEventStore.append(task.id, { type: 'created', payload: { task } })
    return task
  },

  get(id: string): TaskRow | undefined {
    return getDb().prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id)
  },

  list(status?: string, projectId?: string): TaskRow[] {
    if (status && projectId) {
      return getDb()
        .prepare<
          [string, string],
          TaskRow
        >('SELECT * FROM tasks WHERE status = ? AND project_id = ? ORDER BY created_at ASC, rowid ASC')
        .all(status, projectId)
    }
    if (status) {
      return getDb()
        .prepare<[string], TaskRow>('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC, rowid ASC')
        .all(status)
    }
    if (projectId) {
      return getDb()
        .prepare<[string], TaskRow>('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC, rowid ASC')
        .all(projectId)
    }
    return getDb().prepare<[], TaskRow>('SELECT * FROM tasks ORDER BY created_at ASC, rowid ASC').all()
  },

  listByTeam(teamId: string, status?: string): TaskRow[] {
    if (status) {
      return getDb()
        .prepare<[string, string], TaskRow>(
          `
        SELECT * FROM tasks
        WHERE team_id = ? AND status = ?
        ORDER BY created_at DESC
      `,
        )
        .all(teamId, status)
    }
    return getDb()
      .prepare<[string], TaskRow>('SELECT * FROM tasks WHERE team_id = ? ORDER BY created_at DESC')
      .all(teamId)
  },

  updateStatus(id: string, status: string, stage?: string): void {
    const existing = taskStore.get(id)
    if (!existing) return

    const nextStage = stage !== undefined ? stage : existing.stage
    const statusChanged = status !== existing.status
    const stageChanged = nextStage !== existing.stage
    if (!statusChanged && !stageChanged) return

    const completedAt = isTerminalStatus(status) ? new Date().toISOString() : null
    getDb()
      .prepare(
        `
      UPDATE tasks
      SET status = ?, stage = ?, completed_at = ?
      WHERE id = ?
    `,
      )
      .run(status, nextStage, completedAt, id)
    taskEventStore.append(id, {
      type: statusChanged ? 'status_changed' : 'stage_updated',
      payload: { from_status: existing.status, to_status: status, from_stage: existing.stage, to_stage: nextStage },
    })
  },

  assignAgent(taskId: string, agentId: string): void {
    const existing = taskStore.get(taskId)
    if (!existing) return
    getDb().prepare('UPDATE tasks SET assigned_agent_id = ? WHERE id = ?').run(agentId, taskId)
    taskEventStore.append(taskId, {
      type: 'assigned_agent',
      payload: { from_agent_id: existing.assigned_agent_id, to_agent_id: agentId },
    })
  },

  updateAgentReportStatus(taskId: string, status: string | null): void {
    const existing = taskStore.get(taskId)
    if (!existing) return
    const previous = existing.agent_report_status
    if (previous === status) return
    getDb().prepare('UPDATE tasks SET agent_report_status = ? WHERE id = ?').run(status, taskId)
    taskEventStore.append(taskId, {
      type: 'agent_status_changed',
      payload: { from_agent_report_status: previous, to_agent_report_status: status },
    })
  },

  update(id: string, fields: UpdateTaskInput): TaskRow | undefined {
    const existing = taskStore.get(id)
    if (!existing) return undefined

    const updated: TaskRow = {
      ...existing,
      title: fields.title ?? existing.title,
      description: fields.description !== undefined ? fields.description : existing.description,
      status: fields.status ?? existing.status,
      stage: fields.stage ?? existing.stage,
      assigned_agent_id: fields.assignAgentId !== undefined ? fields.assignAgentId : existing.assigned_agent_id,
      assignee_member_id: fields.assigneeMemberId !== undefined ? fields.assigneeMemberId : existing.assignee_member_id,
      completed_at:
        fields.status === undefined
          ? existing.completed_at
          : isTerminalStatus(fields.status)
            ? new Date().toISOString()
            : null,
    }
    getDb()
      .prepare(
        `
      UPDATE tasks
      SET title = @title,
          description = @description,
          status = @status,
          stage = @stage,
          assigned_agent_id = @assigned_agent_id,
          assignee_member_id = @assignee_member_id,
          completed_at = @completed_at
      WHERE id = @id
    `,
      )
      .run(updated)
    taskEventStore.append(id, {
      type: 'updated',
      payload: {
        from_status: existing.status,
        to_status: updated.status,
        stage: updated.stage,
        assigned_agent_id: updated.assigned_agent_id,
        assignee_member_id: updated.assignee_member_id,
      },
    })
    return updated
  },

  delete(id: string): void {
    if (!taskStore.get(id)) return
    taskEventStore.append(id, { type: 'deleted', payload: { task_id: id } })
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  },

  linkSession(taskId: string, sessionId: string): void {
    taskEventStore.append(taskId, { type: 'session_linked', payload: { session_id: sessionId } })
  },

  listSessionIds(taskId: string): string[] {
    const rows = taskEventStore.list(taskId)
    const ids: string[] = []
    for (const row of rows) {
      if (row.type !== 'session_linked') continue
      const parsed = parseTaskEventPayload(row.payload_json)
      const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined
      if (sessionId && !ids.includes(sessionId)) ids.push(sessionId)
    }
    return ids
  },
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'cancelled'
}
