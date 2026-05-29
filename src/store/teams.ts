import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TeamRow {
  id: string
  project_id: string
  name: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface TeamMemberRow {
  id: string
  team_id: string
  project_id: string
  agent_id: string
  session_id: string
  name: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

export interface TeamMailboxRow {
  id: string
  team_id: string
  project_id: string
  from_member_id: string | null
  to_member_id: string | null
  task_id: string | null
  type: string
  content: string
  payload_json: string | null
  created_at: string
}

export interface TeamEventRow {
  id: string
  team_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export interface CreateTeamInput {
  projectId: string
  name: string
  description?: string
}

export interface UpdateTeamInput {
  name?: string
  description?: string | null
  status?: string
}

export interface CreateTeamMemberInput {
  teamId: string
  projectId: string
  agentId: string
  sessionId: string
  name: string
  role?: string
}

export interface CreateTeamMailboxInput {
  teamId: string
  projectId: string
  fromMemberId?: string
  toMemberId?: string
  taskId?: string
  type: string
  content: string
  payload?: unknown
}

export interface AppendTeamEventInput {
  type: string
  payload: unknown
}

export const teamStore = {
  create(input: CreateTeamInput): TeamRow {
    const now = new Date().toISOString()
    const team: TeamRow = {
      id: `team-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? null,
      status: 'active',
      created_at: now,
      updated_at: now,
      archived_at: null,
    }
    getDb().prepare(`
      INSERT INTO teams (id, project_id, name, description, status, created_at, updated_at, archived_at)
      VALUES (@id, @project_id, @name, @description, @status, @created_at, @updated_at, @archived_at)
    `).run(team)
    teamEventStore.append(team.id, { type: 'team.created', payload: { team } })
    return team
  },

  get(id: string): TeamRow | undefined {
    return getDb().prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?').get(id)
  },

  list(projectId?: string): TeamRow[] {
    if (projectId) {
      return getDb().prepare<[string], TeamRow>(`
        SELECT * FROM teams
        WHERE project_id = ? AND archived_at IS NULL
        ORDER BY updated_at DESC
      `).all(projectId)
    }
    return getDb().prepare<[], TeamRow>('SELECT * FROM teams WHERE archived_at IS NULL ORDER BY updated_at DESC').all()
  },

  update(id: string, fields: UpdateTeamInput): TeamRow | undefined {
    const existing = teamStore.get(id)
    if (!existing) return undefined
    const updated: TeamRow = {
      ...existing,
      name: fields.name ?? existing.name,
      description: fields.description !== undefined ? fields.description : existing.description,
      status: fields.status ?? existing.status,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE teams
      SET name = @name, description = @description, status = @status, updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    teamEventStore.append(id, { type: 'team.updated', payload: { team: updated } })
    return updated
  },
}

export const teamMemberStore = {
  create(input: CreateTeamMemberInput): TeamMemberRow {
    const now = new Date().toISOString()
    const existing = getDb().prepare<[string, string], TeamMemberRow>(`
      SELECT * FROM team_members
      WHERE team_id = ? AND agent_id = ? AND status != 'removed'
    `).get(input.teamId, input.agentId)
    if (existing) throw new Error('Agent 已经是该 Team 成员')
    const member: TeamMemberRow = {
      id: `tm-${randomUUID().slice(0, 8)}`,
      team_id: input.teamId,
      project_id: input.projectId,
      agent_id: input.agentId,
      session_id: input.sessionId,
      name: input.name,
      role: input.role ?? 'member',
      status: 'active',
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO team_members (
        id, team_id, project_id, agent_id, session_id, name, role, status, created_at, updated_at
      )
      VALUES (
        @id, @team_id, @project_id, @agent_id, @session_id, @name, @role, @status, @created_at, @updated_at
      )
    `).run(member)
    teamEventStore.append(input.teamId, { type: 'member.created', payload: { member } })
    return member
  },

  get(id: string): TeamMemberRow | undefined {
    return getDb().prepare<[string], TeamMemberRow>('SELECT * FROM team_members WHERE id = ?').get(id)
  },

  getBySession(sessionId: string): TeamMemberRow | undefined {
    return getDb().prepare<[string], TeamMemberRow>('SELECT * FROM team_members WHERE session_id = ?').get(sessionId)
  },

  list(teamId: string): TeamMemberRow[] {
    return getDb().prepare<[string], TeamMemberRow>(`
      SELECT * FROM team_members
      WHERE team_id = ? AND status != 'removed'
      ORDER BY created_at ASC
    `).all(teamId)
  },
}

export const teamMailboxStore = {
  create(input: CreateTeamMailboxInput): TeamMailboxRow {
    const msg: TeamMailboxRow = {
      id: `tmail-${randomUUID().slice(0, 8)}`,
      team_id: input.teamId,
      project_id: input.projectId,
      from_member_id: input.fromMemberId ?? null,
      to_member_id: input.toMemberId ?? null,
      task_id: input.taskId ?? null,
      type: input.type,
      content: input.content,
      payload_json: input.payload === undefined ? null : JSON.stringify(input.payload),
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO team_mailbox (
        id, team_id, project_id, from_member_id, to_member_id, task_id, type, content, payload_json, created_at
      )
      VALUES (
        @id, @team_id, @project_id, @from_member_id, @to_member_id, @task_id, @type, @content, @payload_json, @created_at
      )
    `).run(msg)
    teamEventStore.append(input.teamId, { type: 'mailbox.created', payload: { message: msg } })
    return msg
  },

  list(teamId: string, limit = 50): TeamMailboxRow[] {
    return getDb().prepare<{ teamId: string; limit: number }, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE team_id = @teamId
      ORDER BY created_at DESC
      LIMIT @limit
    `).all({ teamId, limit }).reverse()
  },
}

export const teamEventStore = {
  append(teamId: string, input: AppendTeamEventInput): TeamEventRow {
    const db = getDb()
    const last = db.prepare<[string], { sequence: number }>(`
      SELECT sequence FROM team_events
      WHERE team_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(teamId)
    const event: TeamEventRow = {
      id: `teamevt-${randomUUID().slice(0, 8)}`,
      team_id: teamId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      sequence: (last?.sequence ?? 0) + 1,
      created_at: new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO team_events (id, team_id, type, payload_json, sequence, created_at)
      VALUES (@id, @team_id, @type, @payload_json, @sequence, @created_at)
    `).run(event)
    return event
  },

  list(teamId: string, limit = 100): TeamEventRow[] {
    return getDb().prepare<{ teamId: string; limit: number }, TeamEventRow>(`
      SELECT * FROM team_events
      WHERE team_id = @teamId
      ORDER BY sequence DESC
      LIMIT @limit
    `).all({ teamId, limit }).reverse()
  },
}
