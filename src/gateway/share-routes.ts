import type { Hono } from 'hono'
import { sessionShareStore, type SharePermission, type ShareToolCallVisibility } from '../store/session-shares.js'
import { sessionShareManager } from '../core/session-share-manager.js'
import type { AppConfig } from '../core/config.js'

interface ShareCreateBody {
  sessionId?: string
  shareName?: string
  agentIntro?: string
  permission?: string
  toolCallVisibility?: string
  expiresAt?: string | null
  ownerAgentId?: string
}

interface ShareRenewBody {
  days?: number | null
}

function parsePermission(value: unknown): SharePermission {
  return value === 'readonly' ? 'readonly' : 'chat'
}

function parseVisibility(value: unknown): ShareToolCallVisibility {
  if (value === 'hide') return 'hide'
  if (value === 'expand') return 'expand'
  return 'collapse'
}

function parseExpiresAt(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function parseOwnerAgentIdFromHeader(headerValue: string | string | undefined): string | null {
  if (!headerValue) return null
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!value) return null
  return value
}

export function mountShareRoutes(app: Hono, _config: AppConfig): void {
  app.get('/api/share/:token/bootstrap', (c) => {
    const token = c.req.param('token')
    if (!token) return c.json({ error: 'token 缺失' }, 400)
    const result = sessionShareManager.bootstrapByToken(token)
    if (!result) return c.json({ error: '分享不存在或已失效' }, 404)
    return c.json(result)
  })

  app.post('/api/share/:token/visit', (c) => {
    const token = c.req.param('token')
    if (!token) return c.json({ error: 'token 缺失' }, 400)
    const share = sessionShareStore.getByToken(token)
    if (!share) return c.json({ error: '分享不存在或已失效' }, 404)
    sessionShareManager.recordVisit(token)
    return c.json({ ok: true, visitCount: share.visit_count + 1 })
  })

  app.get('/api/shares', (c) => {
    const ownerAgentId = parseOwnerAgentIdFromHeader(c.req.header('x-ai-ide-owner-agent-id'))
      ?? c.req.query('ownerAgentId')
    if (!ownerAgentId) return c.json({ error: 'ownerAgentId 缺失' }, 400)
    return c.json(sessionShareManager.listSharesByOwner(ownerAgentId))
  })

  app.post('/api/shares', async (c) => {
    const body = await c.req.json<ShareCreateBody>().catch(() => null)
    if (!body) return c.json({ error: '请求体无效' }, 400)
    const ownerAgentId = body.ownerAgentId
      ?? parseOwnerAgentIdFromHeader(c.req.header('x-ai-ide-owner-agent-id'))
    if (!ownerAgentId) return c.json({ error: 'ownerAgentId 缺失' }, 400)
    if (!body.sessionId) return c.json({ error: 'sessionId 缺失' }, 400)
    if (!body.shareName) return c.json({ error: 'shareName 缺失' }, 400)
    if (!body.agentIntro) return c.json({ error: 'agentIntro 缺失' }, 400)
    try {
      const share = sessionShareManager.createShare({
        sessionId: body.sessionId,
        ownerAgentId,
        shareName: body.shareName,
        agentIntro: body.agentIntro,
        permission: parsePermission(body.permission),
        toolCallVisibility: parseVisibility(body.toolCallVisibility),
        expiresAt: parseExpiresAt(body.expiresAt),
      })
      return c.json(share)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : '创建失败' }, 400)
    }
  })

  app.post('/api/shares/:id/revoke', (c) => {
    const id = c.req.param('id')
    const share = sessionShareManager.revokeShare(id)
    if (!share) return c.json({ error: '分享不存在' }, 404)
    return c.json(share)
  })

  app.post('/api/shares/:id/renew', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json<ShareRenewBody>().catch(() => ({}))) as ShareRenewBody
    const days = body.days === null || body.days === undefined ? null : Number(body.days)
    if (days != null && (Number.isNaN(days) || days < 0)) return c.json({ error: 'days 无效' }, 400)
    const share = sessionShareManager.renewShare(id, days)
    if (!share) return c.json({ error: '分享不存在' }, 404)
    return c.json(share)
  })

  app.delete('/api/shares/:id', (c) => {
    const id = c.req.param('id')
    sessionShareStore.softDelete(id)
    return c.json({ ok: true })
  })
}
