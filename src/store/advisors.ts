import { getDb } from './db.js'

export interface ProjectAdvisorRow {
  project_id: string
  session_id: string | null
  advisor_agent_id: string | null
  advisor_prompt: string
  min_silence_minutes: number
  enabled: number
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface ProjectAdvisorData {
  projectId: string
  sessionId: string | null
  advisorAgentId: string | null
  advisorPrompt: string
  minSilenceMinutes: number
  enabled: boolean
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export const projectAdvisorStore = {
  ensure(projectId: string): ProjectAdvisorRow {
    const existing = this.get(projectId)
    if (existing) return existing
    const now = new Date().toISOString()
    const row: ProjectAdvisorRow = {
      project_id: projectId,
      session_id: null,
      advisor_agent_id: null,
      advisor_prompt: '',
      min_silence_minutes: 0,
      enabled: 1,
      last_error: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO project_advisors (
        project_id, session_id, advisor_agent_id, advisor_prompt,
        min_silence_minutes, enabled, last_error, created_at, updated_at
      ) VALUES (
        @project_id, @session_id, @advisor_agent_id, @advisor_prompt,
        @min_silence_minutes, @enabled, @last_error, @created_at, @updated_at
      )
    `).run(row)
    return row
  },

  get(projectId: string): ProjectAdvisorRow | undefined {
    return getDb().prepare<[string], ProjectAdvisorRow>(
      'SELECT * FROM project_advisors WHERE project_id = ?',
    ).get(projectId)
  },

  findBySession(sessionId: string): ProjectAdvisorRow | undefined {
    return getDb().prepare<[string], ProjectAdvisorRow>(
      'SELECT * FROM project_advisors WHERE session_id = ?',
    ).get(sessionId)
  },

  list(): ProjectAdvisorRow[] {
    return getDb().prepare<[], ProjectAdvisorRow>(
      'SELECT * FROM project_advisors ORDER BY updated_at ASC',
    ).all()
  },

  update(
    projectId: string,
    input: {
      sessionId?: string | null
      advisorAgentId?: string | null
      advisorPrompt?: string
      minSilenceMinutes?: number
      enabled?: boolean
      lastError?: string | null
    },
  ): ProjectAdvisorRow {
    const current = this.ensure(projectId)
    const next: ProjectAdvisorRow = {
      ...current,
      session_id: input.sessionId !== undefined ? input.sessionId : current.session_id,
      advisor_agent_id: input.advisorAgentId !== undefined ? input.advisorAgentId : current.advisor_agent_id,
      advisor_prompt: input.advisorPrompt ?? current.advisor_prompt,
      min_silence_minutes: input.minSilenceMinutes !== undefined
        ? Math.max(0, Math.floor(input.minSilenceMinutes))
        : current.min_silence_minutes,
      enabled: input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      last_error: input.lastError !== undefined ? input.lastError : current.last_error,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE project_advisors
      SET session_id = @session_id,
          advisor_agent_id = @advisor_agent_id,
          advisor_prompt = @advisor_prompt,
          min_silence_minutes = @min_silence_minutes,
          enabled = @enabled,
          last_error = @last_error,
          updated_at = @updated_at
      WHERE project_id = @project_id
    `).run(next)
    return next
  },

  toData(row: ProjectAdvisorRow): ProjectAdvisorData {
    return {
      projectId: row.project_id,
      sessionId: row.session_id,
      advisorAgentId: row.advisor_agent_id,
      advisorPrompt: row.advisor_prompt,
      minSilenceMinutes: row.min_silence_minutes,
      enabled: row.enabled === 1,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  },
}
