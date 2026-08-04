import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export type AutonomyReportPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface AutonomyReportAttachment {
  path: string
  title?: string
}

export interface AutonomyReportRow {
  id: string
  project_id: string
  agent_id: string
  session_id: string
  title: string
  summary: string
  priority: AutonomyReportPriority
  body_markdown: string
  attachments_json: string
  created_at: string
}

export interface CreateAutonomyReportInput {
  projectId: string
  agentId: string
  sessionId: string
  title: string
  summary: string
  priority: AutonomyReportPriority
  markdown: string
  attachments?: AutonomyReportAttachment[]
}

export interface AutonomyReportData extends Omit<AutonomyReportRow, 'attachments_json'> {
  attachments: AutonomyReportAttachment[]
}

export const autonomyReportStore = {
  create(input: CreateAutonomyReportInput): AutonomyReportData {
    const row: AutonomyReportRow = {
      id: `arpt-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      agent_id: input.agentId,
      session_id: input.sessionId,
      title: input.title,
      summary: input.summary,
      priority: input.priority,
      body_markdown: input.markdown,
      attachments_json: JSON.stringify(input.attachments ?? []),
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`
      INSERT INTO autonomy_reports (
        id, project_id, agent_id, session_id, title, summary,
        priority, body_markdown, attachments_json, created_at
      ) VALUES (
        @id, @project_id, @agent_id, @session_id, @title, @summary,
        @priority, @body_markdown, @attachments_json, @created_at
      )
    `).run(row)
    return toData(row)
  },

  get(id: string): AutonomyReportData | undefined {
    const row = getDb().prepare<[string], AutonomyReportRow>(
      'SELECT * FROM autonomy_reports WHERE id = ?',
    ).get(id)
    return row ? toData(row) : undefined
  },

  list(projectId: string, options: { agentId?: string; before?: string; limit?: number } = {}): AutonomyReportData[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const conditions = ['project_id = @projectId']
    const params: { projectId: string; agentId?: string; before?: string; limit: number } = { projectId, limit }
    if (options.agentId) {
      conditions.push('agent_id = @agentId')
      params.agentId = options.agentId
    }
    if (options.before) {
      conditions.push('created_at < @before')
      params.before = options.before
    }
    return getDb().prepare<typeof params, AutonomyReportRow>(`
      SELECT * FROM autonomy_reports
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(params).map(toData)
  },
}

function toData(row: AutonomyReportRow): AutonomyReportData {
  return {
    ...row,
    attachments: parseAttachments(row.attachments_json),
  }
}

function parseAttachments(raw: string): AutonomyReportAttachment[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): AutonomyReportAttachment[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      if (typeof record.path !== 'string') return []
      return [{
        path: record.path,
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
      }]
    })
  } catch {
    return []
  }
}
