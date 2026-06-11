import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getDb } from './db.js'

export const GLOBAL_ASSISTANT_ID = 'default'

export interface GlobalAssistantRow {
  id: string
  agent_id: string
  session_id: string
  workspace_dir: string
  enabled: number
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

export interface UpsertGlobalAssistantInput {
  agentId: string
  sessionId: string
  workspaceDir?: string
}

export const globalAssistantStore = {
  defaultWorkspaceRoot(): string {
    const configured = process.env.GLOBAL_ASSISTANT_WORKSPACE_ROOT?.trim()
    if (configured) return resolve(configured)
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) return resolve(localAppData, 'AI IDE Studio', 'global-assistants')
    return resolve(homedir(), '.ai-ide-studio', 'global-assistants')
  },

  defaultWorkspaceDir(agentId: string): string {
    return resolve(globalAssistantStore.defaultWorkspaceRoot(), agentId, 'workspace')
  },

  get(): GlobalAssistantRow | undefined {
    const row = getDb()
      .prepare<[string], GlobalAssistantRow>('SELECT * FROM global_assistant WHERE id = ?')
      .get(GLOBAL_ASSISTANT_ID)
    return row ? globalAssistantStore.ensureAgentWorkspace(row) : undefined
  },

  getBySessionId(sessionId: string): GlobalAssistantRow | undefined {
    const row = getDb()
      .prepare<[string], GlobalAssistantRow>('SELECT * FROM global_assistant WHERE session_id = ? AND enabled = 1')
      .get(sessionId)
    return row ? globalAssistantStore.ensureAgentWorkspace(row) : undefined
  },

  workspaceForSession(sessionId: string): string | undefined {
    return globalAssistantStore.getBySessionId(sessionId)?.workspace_dir
  },

  upsert(input: UpsertGlobalAssistantInput): GlobalAssistantRow {
    const existing = globalAssistantStore.get()
    const now = new Date().toISOString()
    const workspaceDir = resolve(input.workspaceDir || globalAssistantStore.defaultWorkspaceDir(input.agentId))
    mkdirSync(workspaceDir, { recursive: true })

    const row: GlobalAssistantRow = {
      id: GLOBAL_ASSISTANT_ID,
      agent_id: input.agentId,
      session_id: input.sessionId,
      workspace_dir: workspaceDir,
      enabled: 1,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_opened_at: existing?.last_opened_at ?? null,
    }

    if (existing) {
      getDb().prepare(`
        UPDATE global_assistant
        SET agent_id = @agent_id,
            session_id = @session_id,
            workspace_dir = @workspace_dir,
            enabled = @enabled,
            updated_at = @updated_at
        WHERE id = @id
      `).run(row)
      return globalAssistantStore.get() ?? row
    }

    getDb().prepare(`
      INSERT INTO global_assistant (
        id, agent_id, session_id, workspace_dir, enabled, created_at, updated_at, last_opened_at
      )
      VALUES (
        @id, @agent_id, @session_id, @workspace_dir, @enabled, @created_at, @updated_at, @last_opened_at
      )
    `).run(row)
    return row
  },

  ensureAgentWorkspace(row: GlobalAssistantRow): GlobalAssistantRow {
    const workspaceDir = globalAssistantStore.defaultWorkspaceDir(row.agent_id)
    mkdirSync(workspaceDir, { recursive: true })
    if (resolve(row.workspace_dir) === workspaceDir) return row

    const updated = { ...row, workspace_dir: workspaceDir, updated_at: new Date().toISOString() }
    getDb().prepare(`
      UPDATE global_assistant
      SET workspace_dir = @workspace_dir,
          updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    return updated
  },

  touch(): GlobalAssistantRow | undefined {
    const now = new Date().toISOString()
    getDb()
      .prepare('UPDATE global_assistant SET last_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, GLOBAL_ASSISTANT_ID)
    return globalAssistantStore.get()
  },
}
