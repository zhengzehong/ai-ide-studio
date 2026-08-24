import { getDb } from './db.js'

export interface ProjectInspirationRow {
  project_id: string
  session_id: string | null
  organizer_agent_id: string | null
  organization_prompt: string
  auto_organize: number
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface ProjectInspirationData {
  projectId: string
  sessionId: string | null
  organizerAgentId: string | null
  organizationPrompt: string
  autoOrganize: boolean
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export const projectInspirationStore = {
  ensure(projectId: string): ProjectInspirationRow {
    const existing = this.get(projectId)
    if (existing) return existing
    const now = new Date().toISOString()
    const row: ProjectInspirationRow = {
      project_id: projectId,
      session_id: null,
      organizer_agent_id: null,
      organization_prompt: '',
      auto_organize: 1,
      last_error: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO project_inspirations (
        project_id, session_id, organizer_agent_id, organization_prompt,
        auto_organize, last_error, created_at, updated_at
      ) VALUES (
        @project_id, @session_id, @organizer_agent_id, @organization_prompt,
        @auto_organize, @last_error, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  get(projectId: string): ProjectInspirationRow | undefined {
    return getDb().prepare<[string], ProjectInspirationRow>(
      'SELECT * FROM project_inspirations WHERE project_id = ?',
    ).get(projectId)
  },

  findBySession(sessionId: string): ProjectInspirationRow | undefined {
    return getDb().prepare<[string], ProjectInspirationRow>(
      'SELECT * FROM project_inspirations WHERE session_id = ?',
    ).get(sessionId)
  },

  list(): ProjectInspirationRow[] {
    return getDb().prepare<[], ProjectInspirationRow>(
      'SELECT * FROM project_inspirations ORDER BY updated_at ASC',
    ).all()
  },

  update(
    projectId: string,
    input: {
      sessionId?: string | null
      organizerAgentId?: string | null
      organizationPrompt?: string
      autoOrganize?: boolean
      lastError?: string | null
    },
  ): ProjectInspirationRow {
    const current = this.ensure(projectId)
    const next: ProjectInspirationRow = {
      ...current,
      session_id: input.sessionId !== undefined ? input.sessionId : current.session_id,
      organizer_agent_id: input.organizerAgentId !== undefined ? input.organizerAgentId : current.organizer_agent_id,
      organization_prompt: input.organizationPrompt ?? current.organization_prompt,
      auto_organize: input.autoOrganize === undefined ? current.auto_organize : input.autoOrganize ? 1 : 0,
      last_error: input.lastError !== undefined ? input.lastError : current.last_error,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE project_inspirations
      SET session_id = @session_id,
          organizer_agent_id = @organizer_agent_id,
          organization_prompt = @organization_prompt,
          auto_organize = @auto_organize,
          last_error = @last_error,
          updated_at = @updated_at
      WHERE project_id = @project_id
    `).run(next)
    return next
  },

  toData(row: ProjectInspirationRow): ProjectInspirationData {
    return {
      projectId: row.project_id,
      sessionId: row.session_id,
      organizerAgentId: row.organizer_agent_id,
      organizationPrompt: row.organization_prompt,
      autoOrganize: row.auto_organize === 1,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  },
}
