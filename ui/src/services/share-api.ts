import { getStoredAccessToken } from '../stores/connection.store'

export type SharePermission = 'chat' | 'readonly'
export type ShareToolCallVisibility = 'hide' | 'collapse' | 'expand'

export interface ShareRow {
  id: string
  share_token: string
  session_id: string
  agent_id: string
  owner_agent_id: string
  share_name: string
  agent_intro: string
  permission: SharePermission
  tool_call_visibility: ShareToolCallVisibility
  expires_at: string | null
  revoked_at: string | null
  deleted_at: string | null
  visit_count: number
  last_visited_at: string | null
  created_at: string
  updated_at: string
}

export interface ShareBootstrapResult {
  share: ShareRow
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

export interface CreateShareInput {
  sessionId: string
  ownerAgentId: string
  shareName: string
  agentIntro: string
  permission?: SharePermission
  toolCallVisibility?: ShareToolCallVisibility
  expiresAt?: string | null
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `请求失败 (${res.status})`)
  }
  return res.json() as Promise<T>
}

function ownerHeaders(ownerAgentId?: string): Record<string, string> {
  const token = getStoredAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers['x-ai-ide-token'] = token
  if (ownerAgentId) headers['x-ai-ide-owner-agent-id'] = ownerAgentId
  return headers
}

export async function bootstrapShare(token: string): Promise<ShareBootstrapResult> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}/bootstrap`)
  return parseJson<ShareBootstrapResult>(res)
}

export async function recordShareVisit(token: string): Promise<void> {
  await fetch(`/api/share/${encodeURIComponent(token)}/visit`, { method: 'POST' }).catch(() => {})
}

export async function listShares(ownerAgentId: string, sessionId?: string): Promise<ShareRow[]> {
  const params = new URLSearchParams({ ownerAgentId })
  if (sessionId) params.set('sessionId', sessionId)
  const res = await fetch(`/api/shares?${params.toString()}`, { headers: ownerHeaders(ownerAgentId) })
  return parseJson<ShareRow[]>(res)
}

export async function createShare(input: CreateShareInput): Promise<ShareRow> {
  const res = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders(input.ownerAgentId) },
    body: JSON.stringify(input),
  })
  return parseJson<ShareRow>(res)
}

export async function revokeShare(id: string, ownerAgentId: string): Promise<ShareRow> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: ownerHeaders(ownerAgentId),
  })
  return parseJson<ShareRow>(res)
}

export async function renewShare(id: string, days: number | null, ownerAgentId: string): Promise<ShareRow> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}/renew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders(ownerAgentId) },
    body: JSON.stringify({ days }),
  })
  return parseJson<ShareRow>(res)
}

export async function deleteShare(id: string, ownerAgentId: string): Promise<void> {
  const res = await fetch(`/api/shares/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: ownerHeaders(ownerAgentId),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `删除失败 (${res.status})`)
  }
}
