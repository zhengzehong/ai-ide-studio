import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import type { TeamConversationRow } from './team-conversations.js'

export interface TeamContactRow {
  id: string
  project_id: string
  source_session_id: string
  team_id: string
  conversation_id: string
  created_at: string
}

export const teamContactStore = {
  listConversationIds(sessionId: string, teamId: string): string[] {
    return getDb().prepare<[string, string, string, string], { id: string }>(`
      SELECT conversation_id AS id FROM team_contacts WHERE source_session_id = ? AND team_id = ?
      UNION SELECT peer.id FROM team_contacts c
      JOIN team_conversations own ON own.id = c.conversation_id
      JOIN team_conversations peer ON peer.master_session_id = c.source_session_id
      WHERE own.master_session_id = ? AND peer.team_id = ?
    `).all(sessionId, teamId, sessionId, teamId).map(row => row.id)
  },
  find(sourceSessionId: string, teamId: string): TeamContactRow | undefined {
    return getDb().prepare<[string, string], TeamContactRow>('SELECT * FROM team_contacts WHERE source_session_id = ? AND team_id = ?').get(sourceSessionId, teamId)
  },
  ensure(input: { projectId: string; sourceSessionId: string; teamId: string }, create: () => TeamConversationRow): TeamContactRow {
    return getDb().transaction(() => {
      const existing = teamContactStore.find(input.sourceSessionId, input.teamId)
      if (existing) return existing
      const conversation = create()
      const row: TeamContactRow = {
        id: `contact-${randomUUID()}`, project_id: input.projectId,
        source_session_id: input.sourceSessionId, team_id: input.teamId,
        conversation_id: conversation.id, created_at: new Date().toISOString(),
      }
      getDb().prepare('INSERT INTO team_contacts VALUES (@id, @project_id, @source_session_id, @team_id, @conversation_id, @created_at)').run(row)
      return row
    }).immediate()
  },
  connects(source: string, target: string): boolean {
    return !!getDb().prepare<[string, string, string, string], { id: string }>(`
      SELECT c.id FROM team_contacts c JOIN team_conversations tc ON tc.id = c.conversation_id
      JOIN teams t ON t.id = c.team_id
      WHERE tc.status = 'active' AND t.status = 'active' AND t.archived_at IS NULL
      AND ((c.source_session_id = ? AND tc.master_session_id = ?) OR
           (c.source_session_id = ? AND tc.master_session_id = ?)) LIMIT 1
    `).get(source, target, target, source)
  },
  hasPair(source: string, target: string): boolean {
    return !!getDb().prepare<[string, string, string, string], { id: string }>(`
      SELECT c.id FROM team_contacts c JOIN team_conversations tc ON tc.id = c.conversation_id
      WHERE (c.source_session_id = ? AND tc.master_session_id = ?) OR
            (c.source_session_id = ? AND tc.master_session_id = ?) LIMIT 1
    `).get(source, target, target, source)
  },
}
