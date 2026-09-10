import { getDb } from './db.js'
import type { TeamMemberRow } from './teams.js'

export interface MemberSessionLink { session_id: string; conversation_id: string | null }

export const teamIdentityTransitionStore = {
  transaction<T>(work: () => T): T { return getDb().transaction(work).immediate() },
  links(memberId: string): MemberSessionLink[] {
    return getDb().prepare<[string, string], MemberSessionLink>(`
      SELECT session_id, max(conversation_id) AS conversation_id FROM (
        SELECT session_id, conversation_id FROM team_conversation_members WHERE member_id = ? AND session_id IS NOT NULL
        UNION SELECT session_id, NULL FROM team_members WHERE id = ?
      ) GROUP BY session_id`).all(memberId, memberId)
  },
  owners(sessionId: string): number {
    return getDb().prepare<[string, string], { count: number }>(`
      SELECT count(*) AS count FROM (
        SELECT member_id FROM team_conversation_members WHERE session_id = ?
        UNION SELECT id FROM team_members WHERE session_id = ?
      )`).get(sessionId, sessionId)!.count
  },
  history(sessionId: string): { member_id: string; replacement_session_id: string } | undefined {
    return getDb().prepare<[string], { member_id: string; replacement_session_id: string }>(
      'SELECT member_id, replacement_session_id FROM team_member_session_history WHERE session_id = ?').get(sessionId)
  },
  previousSession(sessionId: string): string | undefined {
    return getDb().prepare<[string], { session_id: string }>('SELECT session_id FROM team_member_session_history WHERE replacement_session_id = ? LIMIT 1').get(sessionId)?.session_id
  },
  busy(memberId: string): boolean {
    return !!getDb().prepare<[string, string], { id: string }>(`
      SELECT s.id FROM sessions s WHERE (s.id IN (SELECT session_id FROM team_conversation_members WHERE member_id = ?)
        OR s.id IN (SELECT session_id FROM team_members WHERE id = ?))
      AND s.stage IN ('thinking', 'executing', 'responding', 'connecting') LIMIT 1`).get(memberId, memberId)
  },
  replaceSession(member: TeamMemberRow, oldId: string, newId: string, conversationId: string | null, preserveSource = false): void {
    const db = getDb()
    db.prepare(`UPDATE sessions SET title = (SELECT title FROM sessions WHERE id = @oldId),
      status = (SELECT status FROM sessions WHERE id = @oldId),
      archived_at = (SELECT archived_at FROM sessions WHERE id = @oldId),
      deleted_at = (SELECT deleted_at FROM sessions WHERE id = @oldId),
      closed_at = (SELECT closed_at FROM sessions WHERE id = @oldId) WHERE id = @newId`).run({ oldId, newId })
    if (!preserveSource) {
      db.prepare('INSERT INTO team_member_session_history VALUES (?, ?, ?, ?, ?)')
        .run(oldId, member.id, conversationId, newId, new Date().toISOString())
      db.prepare("UPDATE sessions SET status = 'closed', closed_at = ? WHERE id = ?").run(new Date().toISOString(), oldId)
      db.prepare('UPDATE team_contacts SET source_session_id = ? WHERE source_session_id = ?').run(newId, oldId)
    }
    db.prepare('UPDATE team_conversation_members SET session_id = ? WHERE member_id = ? AND session_id = ?').run(newId, member.id, oldId)
    db.prepare('UPDATE team_conversations SET master_session_id = ? WHERE team_id = ? AND master_session_id = ?').run(newId, member.team_id, oldId)
  },
  replaceMember(memberId: string, agentId: string, sessionId: string): void {
    getDb().prepare('UPDATE team_members SET agent_id = ?, session_id = ?, updated_at = ? WHERE id = ?')
      .run(agentId, sessionId, new Date().toISOString(), memberId)
  },
  retargetTasks(member: TeamMemberRow, newAgentId: string, replacements: Map<string, string>, preserved: Set<string>): void {
    const db = getDb()
    db.prepare(`UPDATE tasks SET assigned_agent_id = ? WHERE team_id = ? AND assignee_member_id = ?
      AND status NOT IN ('completed', 'cancelled')`).run(newAgentId, member.team_id, member.id)
    db.prepare(`UPDATE task_steps SET assignee_agent_id = ? WHERE assignee_agent_id = ? AND session_id IS NULL
      AND status != 'done' AND task_id IN (SELECT id FROM tasks WHERE team_id = ? AND status NOT IN ('completed', 'cancelled'))`)
      .run(newAgentId, member.agent_id, member.team_id)
    for (const [oldId, newId] of replacements) {
      db.prepare(`UPDATE task_steps SET session_id = ?, assignee_agent_id = ?
        WHERE session_id = ? AND status != 'done'
        AND task_id IN (SELECT id FROM tasks WHERE status NOT IN ('completed', 'cancelled'))
        AND (? = 0 OR task_id IN (SELECT id FROM tasks WHERE team_id = ?))`)
        .run(newId, newAgentId, oldId, preserved.has(oldId) ? 1 : 0, member.team_id)
      db.prepare(`UPDATE tasks SET initiator_session_id = ?, initiator_agent_id = ?
        WHERE initiator_session_id = ? AND status NOT IN ('completed', 'cancelled')
        AND (? = 0 OR team_id = ?)`)
        .run(newId, newAgentId, oldId, preserved.has(oldId) ? 1 : 0, member.team_id)
    }
  },
}
