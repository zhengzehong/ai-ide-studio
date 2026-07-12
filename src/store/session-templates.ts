import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:session-templates')

export interface SessionTemplateRow {
  id: string
  name: string
  description: string | null
  agent_id: string
  project_id: string | null
  runtime: string
  source_session_id: string
  template_session_id: string
  icon: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateSessionTemplateInput {
  name: string
  description?: string | null
  agentId: string
  projectId?: string | null
  runtime: string
  sourceSessionId: string
  templateSessionId: string
  icon?: string | null
}

export interface UpdateSessionTemplateInput {
  name?: string
  description?: string | null
  icon?: string | null
}

export interface ListSessionTemplateFilter {
  agentId?: string
  projectId?: string
}

function mapRow(row: Record<string, unknown>): SessionTemplateRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    agent_id: String(row.agent_id),
    project_id: row.project_id == null ? null : String(row.project_id),
    runtime: String(row.runtime),
    source_session_id: String(row.source_session_id),
    template_session_id: String(row.template_session_id),
    icon: row.icon == null ? null : String(row.icon),
    use_count: Number(row.use_count),
    last_used_at: row.last_used_at == null ? null : String(row.last_used_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export const sessionTemplateStore = {
  create(input: CreateSessionTemplateInput): SessionTemplateRow {
    const now = new Date().toISOString()
    const row: SessionTemplateRow = {
      id: `tpl-sess-${randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description ?? null,
      agent_id: input.agentId,
      project_id: input.projectId ?? null,
      runtime: input.runtime,
      source_session_id: input.sourceSessionId,
      template_session_id: input.templateSessionId,
      icon: input.icon ?? null,
      use_count: 0,
      last_used_at: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO session_templates (
        id, name, description, agent_id, project_id, runtime,
        source_session_id, template_session_id, icon,
        use_count, last_used_at, created_at, updated_at
      )
      VALUES (
        @id, @name, @description, @agent_id, @project_id, @runtime,
        @source_session_id, @template_session_id, @icon,
        @use_count, @last_used_at, @created_at, @updated_at
      )
    `).run(row)
    log.info(
      { templateId: row.id, agentId: row.agent_id, sourceSessionId: row.source_session_id, templateSessionId: row.template_session_id },
      'session template created',
    )
    return sessionTemplateStore.get(row.id)!
  },

  get(id: string): SessionTemplateRow | undefined {
    const row = getDb().prepare('SELECT * FROM session_templates WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapRow(row) : undefined
  },

  list(filter?: ListSessionTemplateFilter): SessionTemplateRow[] {
    const conditions: string[] = []
    const params: string[] = []
    if (filter?.agentId) {
      conditions.push('agent_id = ?')
      params.push(filter.agentId)
    }
    if (filter?.projectId) {
      conditions.push('project_id = ?')
      params.push(filter.projectId)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT * FROM session_templates ${where} ORDER BY created_at DESC`
    const rows = getDb()
      .prepare<string[]>(sql)
      .all(...params) as Record<string, unknown>[]
    return rows.map(mapRow)
  },

  update(id: string, fields: UpdateSessionTemplateInput): SessionTemplateRow | undefined {
    const current = sessionTemplateStore.get(id)
    if (!current) return undefined
    const next: SessionTemplateRow = {
      ...current,
      name: fields.name ?? current.name,
      description: fields.description !== undefined ? fields.description : current.description,
      icon: fields.icon !== undefined ? fields.icon : current.icon,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE session_templates
      SET name = @name,
          description = @description,
          icon = @icon,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id,
      name: next.name,
      description: next.description,
      icon: next.icon,
      updated_at: next.updated_at,
    })
    return sessionTemplateStore.get(id)
  },

  delete(id: string): void {
    const result = getDb().prepare('DELETE FROM session_templates WHERE id = ?').run(id)
    if (result.changes > 0) {
      log.info({ templateId: id }, 'session template deleted')
    }
  },

  incrementUseCount(id: string): void {
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE session_templates
      SET use_count = use_count + 1, last_used_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)
  },
}
