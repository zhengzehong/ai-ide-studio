import { sessionShareStore, generateShareToken, type SessionShareRow, type SharePermission, type ShareToolCallVisibility } from '../store/session-shares.js'
import { sessionStore, messageStore } from '../store/sessions.js'
import { agentStore } from '../store/agents.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('session-share-manager')

export interface CreateShareInput {
  sessionId: string
  ownerAgentId: string
  shareName: string
  agentIntro: string
  permission?: SharePermission
  toolCallVisibility?: ShareToolCallVisibility
  expiresAt?: string | null
}

export interface ShareBootstrapResult {
  share: SessionShareRow
  session: {
    id: string
    agent_id: string
    title: string | null
    project_id: string | null
  }
  agent: {
    id: string
    name: string
    icon: string
    avatar_url: string | null
  } | null
  recentMessages: Array<{
    id: string
    role: string
    content: string
    sender_role: string | null
    sender_id: string | null
    sender_name: string | null
    timestamp: string
  }>
}

function computeExpiresAt(days: number | null): string | null {
  if (days == null) return null
  const d = new Date()
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

export const sessionShareManager = {
  createShare(input: CreateShareInput): SessionShareRow {
    const session = sessionStore.get(input.sessionId)
    if (!session) throw new Error(`Session not found: ${input.sessionId}`)
    if (session.agent_id !== input.ownerAgentId) {
      throw new Error('只有会话所属 Agent 可以创建分享')
    }
    const shareToken = generateShareToken()
    const row = sessionShareStore.create({
      sessionId: input.sessionId,
      agentId: session.agent_id,
      ownerAgentId: input.ownerAgentId,
      shareName: input.shareName,
      agentIntro: input.agentIntro,
      permission: input.permission ?? 'chat',
      toolCallVisibility: input.toolCallVisibility ?? 'collapse',
      expiresAt: input.expiresAt ?? null,
      shareToken,
    })
    log.info({ shareId: row.id, sessionId: row.session_id, ownerAgentId: row.owner_agent_id, permission: row.permission }, 'share created')
    return row
  },

  revokeShare(id: string): SessionShareRow | undefined {
    return sessionShareStore.revoke(id)
  },

  renewShare(id: string, days: number | null): SessionShareRow | undefined {
    const expiresAt = computeExpiresAt(days)
    return sessionShareStore.renew(id, expiresAt)
  },

  listSharesByOwner(ownerAgentId: string): SessionShareRow[] {
    return sessionShareStore.listByOwner(ownerAgentId)
  },

  listSharesBySession(sessionId: string): SessionShareRow[] {
    return sessionShareStore.listBySession(sessionId)
  },

  bootstrapByToken(token: string): ShareBootstrapResult | null {
    const share = sessionShareStore.getByToken(token)
    if (!share) return null
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return null
    const session = sessionStore.get(share.session_id)
    if (!session || session.deleted_at) return null
    const agent = agentStore.get(share.agent_id) ?? null
    const recentMessages = messageStore.list(share.session_id, { limit: 100 }).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sender_role: m.sender_role ?? null,
      sender_id: m.sender_id ?? null,
      sender_name: m.sender_name ?? null,
      timestamp: m.timestamp,
    }))
    return {
      share,
      session: {
        id: session.id,
        agent_id: session.agent_id,
        title: session.title,
        project_id: session.project_id,
      },
      agent: agent
        ? { id: agent.id, name: agent.name, icon: agent.icon, avatar_url: agent.avatar_url }
        : null,
      recentMessages,
    }
  },

  recordVisit(token: string): void {
    sessionShareStore.incrementVisit(token)
  },

  cascadeSoftDeleteBySession(sessionId: string): number {
    return sessionShareStore.softDeleteBySession(sessionId)
  },
}
