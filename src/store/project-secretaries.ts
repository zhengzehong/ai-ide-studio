import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export type SecretaryTriggerType = 'cron' | 'session_done' | 'task_needs_input'

export interface ProjectSecretaryRow {
  id: string
  project_id: string
  name: string
  definition_prompt: string
  report_prompt: string
  execution_agent_id: string
  runtime_session_id: string | null
  chat_session_id: string | null
  enabled: number
  observe_all: number
  last_run_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface ProjectSecretaryData {
  id: string
  projectId: string
  name: string
  definitionPrompt: string
  reportPrompt: string
  executionAgentId: string
  runtimeSessionId: string | null
  chatSessionId: string | null
  enabled: boolean
  observeAll: boolean
  observedAgentIds: string[]
  triggers: SecretaryTriggerData[]
  lastRunAt: string | null
  lastError: string | null
  unreadCount: number
  createdAt: string
  updatedAt: string
}

export interface SecretaryTriggerData {
  id: string
  secretaryId: string
  type: SecretaryTriggerType
  cron: string | null
  eventType: string | null
  enabled: boolean
}

export interface CreateSecretaryTriggerInput {
  secretaryId: string
  type: SecretaryTriggerType
  cron?: string
  eventType?: string
}

export interface CreateSecretaryInput {
  projectId: string
  name: string
  definitionPrompt: string
  reportPrompt: string
  executionAgentId: string
  observeAll?: boolean
  observedAgentIds?: string[]
}

export interface UpdateSecretaryInput {
  name?: string
  definitionPrompt?: string
  reportPrompt?: string
  executionAgentId?: string
  enabled?: boolean
  observeAll?: boolean
  observedAgentIds?: string[]
}

export const projectSecretaryStore = {
  create(input: CreateSecretaryInput): ProjectSecretaryRow {
    const now = new Date().toISOString()
    const row: ProjectSecretaryRow = {
      id: `secretary-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      name: input.name,
      definition_prompt: input.definitionPrompt,
      report_prompt: input.reportPrompt,
      execution_agent_id: input.executionAgentId,
      runtime_session_id: null,
      chat_session_id: null,
      enabled: 1,
      observe_all: input.observeAll ? 1 : 0,
      last_run_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO project_secretaries (
        id, project_id, name, definition_prompt, report_prompt, execution_agent_id,
        runtime_session_id, chat_session_id, enabled, observe_all, last_run_at,
        last_error, created_at, updated_at
      ) VALUES (
        @id, @project_id, @name, @definition_prompt, @report_prompt, @execution_agent_id,
        @runtime_session_id, @chat_session_id, @enabled, @observe_all, @last_run_at,
        @last_error, @created_at, @updated_at
      )
    `).run(row)
    replaceObservers(row.id, input.observedAgentIds ?? [])
    return row
  },

  get(id: string): ProjectSecretaryRow | undefined {
    return getDb().prepare<[string], ProjectSecretaryRow>(
      'SELECT * FROM project_secretaries WHERE id = ?',
    ).get(id)
  },

  findBySession(sessionId: string): ProjectSecretaryRow | undefined {
    return getDb().prepare<[string, string], ProjectSecretaryRow>(`
      SELECT * FROM project_secretaries
      WHERE runtime_session_id = ? OR chat_session_id = ?
      LIMIT 1
    `).get(sessionId, sessionId)
  },

  list(projectId: string): ProjectSecretaryRow[] {
    return getDb().prepare<[string], ProjectSecretaryRow>(
      'SELECT * FROM project_secretaries WHERE project_id = ? ORDER BY updated_at DESC, id DESC',
    ).all(projectId)
  },

  update(id: string, input: UpdateSecretaryInput): ProjectSecretaryRow {
    const current = requireSecretary(id)
    const next: ProjectSecretaryRow = {
      ...current,
      name: input.name ?? current.name,
      definition_prompt: input.definitionPrompt ?? current.definition_prompt,
      report_prompt: input.reportPrompt ?? current.report_prompt,
      execution_agent_id: input.executionAgentId ?? current.execution_agent_id,
      enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      observe_all: input.observeAll === undefined ? current.observe_all : input.observeAll ? 1 : 0,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE project_secretaries
      SET name = @name, definition_prompt = @definition_prompt, report_prompt = @report_prompt,
          execution_agent_id = @execution_agent_id, enabled = @enabled, observe_all = @observe_all,
          updated_at = @updated_at
      WHERE id = @id
    `).run(next)
    if (input.observedAgentIds) replaceObservers(id, input.observedAgentIds)
    return next
  },

  setSessions(id: string, runtimeSessionId: string, chatSessionId: string): ProjectSecretaryRow {
    getDb().prepare(`
      UPDATE project_secretaries
      SET runtime_session_id = ?, chat_session_id = ?, updated_at = ?
      WHERE id = ?
    `).run(runtimeSessionId, chatSessionId, new Date().toISOString(), id)
    return requireSecretary(id)
  },

  createTrigger(input: CreateSecretaryTriggerInput): SecretaryTriggerData {
    const id = `secretary-trigger-${randomUUID().slice(0, 8)}`
    getDb().prepare(`
      INSERT INTO project_secretary_triggers (id, secretary_id, type, cron, event_type, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.secretaryId, input.type, input.cron ?? null, input.eventType ?? null, new Date().toISOString(), new Date().toISOString())
    return listTriggerData(input.secretaryId).find((item) => item.id === id)!
  },

  deleteTriggers(id: string): void {
    getDb().prepare('DELETE FROM project_secretary_triggers WHERE secretary_id = ?').run(id)
  },

  deleteTriggersByType(id: string, type: SecretaryTriggerType): void {
    getDb().prepare('DELETE FROM project_secretary_triggers WHERE secretary_id = ? AND type = ?').run(id, type)
  },

  markRun(id: string, error: string | null): void {
    getDb().prepare(`
      UPDATE project_secretaries
      SET last_run_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error, new Date().toISOString(), id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM project_secretaries WHERE id = ?').run(id)
  },

  getData(id: string): ProjectSecretaryData | undefined {
    const row = this.get(id)
    return row ? toData(row) : undefined
  },

  listData(projectId: string): ProjectSecretaryData[] {
    return this.list(projectId).map(toData)
  },
}

function requireSecretary(id: string): ProjectSecretaryRow {
  const row = projectSecretaryStore.get(id)
  if (!row) throw new Error('秘书不存在')
  return row
}

function replaceObservers(secretaryId: string, agentIds: string[]): void {
  const db = getDb()
  const apply = db.transaction(() => {
    db.prepare('DELETE FROM project_secretary_observers WHERE secretary_id = ?').run(secretaryId)
    const insert = db.prepare('INSERT OR IGNORE INTO project_secretary_observers (secretary_id, agent_id) VALUES (?, ?)')
    for (const agentId of [...new Set(agentIds)]) insert.run(secretaryId, agentId)
  })
  apply()
}

function listObserverIds(secretaryId: string): string[] {
  return getDb().prepare<[string], { agent_id: string }>(
    'SELECT agent_id FROM project_secretary_observers WHERE secretary_id = ? ORDER BY agent_id',
  ).all(secretaryId).map((row) => row.agent_id)
}

function listTriggerData(secretaryId: string): SecretaryTriggerData[] {
  return getDb().prepare<[string], {
    id: string
    secretary_id: string
    type: SecretaryTriggerType
    cron: string | null
    event_type: string | null
    enabled: number
  }>(
    'SELECT * FROM project_secretary_triggers WHERE secretary_id = ? ORDER BY created_at ASC',
  ).all(secretaryId).map((row) => ({
    id: row.id,
    secretaryId: row.secretary_id,
    type: row.type,
    cron: row.cron,
    eventType: row.event_type,
    enabled: row.enabled === 1,
  }))
}

function toData(row: ProjectSecretaryRow): ProjectSecretaryData {
  const unreadRow = getDb().prepare<[string], { count: number }>(
    'SELECT COUNT(*) AS count FROM secretary_threads WHERE secretary_id = ? AND status != \'archived\' AND unread = 1',
  ).get(row.id)
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    definitionPrompt: row.definition_prompt,
    reportPrompt: row.report_prompt,
    executionAgentId: row.execution_agent_id,
    runtimeSessionId: row.runtime_session_id,
    chatSessionId: row.chat_session_id,
    enabled: row.enabled === 1,
    observeAll: row.observe_all === 1,
    observedAgentIds: listObserverIds(row.id),
    triggers: listTriggerData(row.id),
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    unreadCount: unreadRow?.count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
