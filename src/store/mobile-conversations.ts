import { getDb } from './db.js'

export function listTeamSessionIds(projectId?: string): string[] {
  return getDb().prepare<{ projectId: string | null }, { id: string }>(`
    SELECT s.id FROM sessions s WHERE (@projectId IS NULL OR s.project_id = @projectId)
      AND (EXISTS (SELECT 1 FROM team_conversation_members m WHERE m.session_id = s.id)
        OR EXISTS (SELECT 1 FROM team_conversations c WHERE c.master_session_id = s.id))
  `).all({ projectId: projectId ?? null }).map(row => row.id)
}
