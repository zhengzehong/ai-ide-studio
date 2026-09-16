import { randomUUID } from 'crypto'
import { getDb } from './db.js'

export interface TeamConversationRow {
  id: string
  team_id: string
  master_session_id: string
  title: string
  status: string
  last_sequence: number
  created_at: string
  updated_at: string
}

export interface TeamConversationMemberRow {
  conversation_id: string
  member_id: string
  session_id: string | null
  joined_at: string
  left_at: string | null
}

export interface TeamGridActivityRow {
  conversation_id: string
  /** 格子所属成员；团队线 master 会话的格子也在 tcm 里（leader 行）。 */
  member_id: string | null
  session_id: string | null
  status: string | null
  stage: string | null
  has_running_agent_message: number
  has_running_process_item: number
}

export interface TeamMessageRow {
  id: string
  conversation_id: string
  sequence: number
  source: string
  agent_id: string | null
  member_id: string | null
  session_id: string | null
  kind: string
  content_json: string
  source_message_id: string | null
  created_at: string
}

export const teamConversationStore = {
  create(teamId: string, masterSessionId: string, title: string): TeamConversationRow {
    const now = new Date().toISOString()
    const row: TeamConversationRow = {
      id: `tc-${randomUUID().slice(0, 8)}`,
      team_id: teamId,
      master_session_id: masterSessionId,
      title: title.trim() || '新团队会话',
      status: 'active',
      last_sequence: 0,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`INSERT INTO team_conversations
      (id, team_id, master_session_id, title, status, last_sequence, created_at, updated_at)
      VALUES (@id, @team_id, @master_session_id, @title, @status, @last_sequence, @created_at, @updated_at)`).run(row)
    return row
  },

  get(id: string): TeamConversationRow | undefined {
    return getDb().prepare<[string], TeamConversationRow>('SELECT * FROM team_conversations WHERE id = ?').get(id)
  },

  getBySession(sessionId: string): TeamConversationRow | undefined {
    return getDb().prepare<[string], TeamConversationRow>(`SELECT tc.* FROM team_conversations tc
      JOIN team_conversation_members tcm ON tcm.conversation_id = tc.id
      WHERE tcm.session_id = ? AND tcm.left_at IS NULL AND tc.status = 'active' LIMIT 1`).get(sessionId)
  },

  list(teamId: string): TeamConversationRow[] {
    return getDb().prepare<[string], TeamConversationRow>(`SELECT * FROM team_conversations
      WHERE team_id = ? AND status != 'deleted' ORDER BY updated_at DESC`).all(teamId)
  },

  updateTitle(id: string, title: string): TeamConversationRow | undefined {
    getDb().prepare('UPDATE team_conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title.trim() || '新团队会话', new Date().toISOString(), id)
    return teamConversationStore.get(id)
  },

  setStatus(id: string, status: string): TeamConversationRow | undefined {
    getDb().prepare('UPDATE team_conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id)
    return teamConversationStore.get(id)
  },

  addMember(conversationId: string, memberId: string, sessionId: string | null): TeamConversationMemberRow {
    const row: TeamConversationMemberRow = {
      conversation_id: conversationId,
      member_id: memberId,
      session_id: sessionId,
      joined_at: new Date().toISOString(),
      left_at: null,
    }
    getDb().prepare(`INSERT OR REPLACE INTO team_conversation_members
      (conversation_id, member_id, session_id, joined_at, left_at)
      VALUES (@conversation_id, @member_id, @session_id, @joined_at, NULL)`).run(row)
    return row
  },

  listMembers(conversationId: string): TeamConversationMemberRow[] {
    return getDb().prepare<[string], TeamConversationMemberRow>(`SELECT * FROM team_conversation_members
      WHERE conversation_id = ? AND left_at IS NULL ORDER BY joined_at ASC`).all(conversationId)
  },

  /** 成员在所有活跃会话线中的格子（session_id 非空），用于判断"首次进线可复用 primary session"。 */
  listMemberGrids(memberId: string): TeamConversationMemberRow[] {
    return getDb().prepare<[string], TeamConversationMemberRow>(`SELECT tcm.* FROM team_conversation_members tcm
      JOIN team_conversations tc ON tc.id = tcm.conversation_id
      WHERE tcm.member_id = ? AND tcm.left_at IS NULL AND tc.status = 'active' AND tcm.session_id IS NOT NULL
      ORDER BY tcm.joined_at ASC`).all(memberId)
  },

  /** 线内全部格子 session 的运行信号（含成员格子），供 core 聚合成"任一格子在跑 → 线 running"。 */
  listGridActivity(teamId: string): TeamGridActivityRow[] {
    return getDb().prepare<[string], TeamGridActivityRow>(`
      SELECT tcm.conversation_id, tcm.member_id, tcm.session_id, s.status, s.stage,
        CASE WHEN s.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM messages msg WHERE msg.session_id = s.id AND msg.role = 'agent' AND msg.status = 'running'
        ) THEN 1 ELSE 0 END AS has_running_agent_message,
        CASE WHEN s.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM turn_process_items item WHERE item.session_id = s.id AND item.status IN ('running', 'pending', 'in_progress')
        ) THEN 1 ELSE 0 END AS has_running_process_item
      FROM team_conversation_members tcm
      JOIN team_conversations tc ON tc.id = tcm.conversation_id
      LEFT JOIN sessions s ON s.id = tcm.session_id
      WHERE tc.team_id = ? AND tc.status != 'deleted' AND tcm.left_at IS NULL`).all(teamId)
  },

  appendMessage(input: Omit<TeamMessageRow, 'id' | 'sequence' | 'created_at'>): TeamMessageRow {
    const db = getDb()
    const tx = db.transaction(() => {
      const conversation = teamConversationStore.get(input.conversation_id)
      if (!conversation) throw new Error('团队会话不存在')
      const row: TeamMessageRow = {
        ...input,
        id: `tmsg-${randomUUID().slice(0, 8)}`,
        sequence: conversation.last_sequence + 1,
        created_at: new Date().toISOString(),
      }
      db.prepare(`INSERT INTO team_messages
        (id, conversation_id, sequence, source, agent_id, member_id, session_id, kind, content_json, source_message_id, created_at)
        VALUES (@id, @conversation_id, @sequence, @source, @agent_id, @member_id, @session_id, @kind, @content_json, @source_message_id, @created_at)`).run(row)
      db.prepare('UPDATE team_conversations SET last_sequence = ?, updated_at = ? WHERE id = ?')
        .run(row.sequence, row.created_at, row.conversation_id)
      return row
    })
    return tx()
  },

  listMessages(conversationId: string, afterSequence = 0, limit = 200): TeamMessageRow[] {
    return getDb().prepare<{ conversationId: string; afterSequence: number; limit: number }, TeamMessageRow>(`SELECT * FROM team_messages
      WHERE conversation_id = @conversationId AND sequence > @afterSequence ORDER BY sequence ASC LIMIT @limit`)
      .all({ conversationId, afterSequence, limit })
  },
}
