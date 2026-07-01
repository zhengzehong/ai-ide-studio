import type { Context } from 'hono'
import type { AppConfig } from '../core/config.js'
import { sessionStore } from '../store/sessions.js'
import { sessionManager } from '../core/sessions.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('bridge-callback')

interface BridgeCallbackFile {
  fileId: string
  name: string
  size: number
  mimeType: string
}

interface BridgeCallbackContent {
  type: 'text' | 'json'
  text?: string
  data?: unknown
  files?: BridgeCallbackFile[]
}

interface BridgeCallbackPayload {
  event: string
  messageId: string
  fromAgentId?: string
  fromAgentName?: string
  toAgentId?: string
  toAgentName?: string
  content: BridgeCallbackContent
  conversationId?: string
  timestamp?: number
  extra?: { sessionId?: string; [k: string]: unknown }
}

export async function handleBridgeCallback(c: Context, config: AppConfig): Promise<Response> {
  if (config.bridgeCallbackToken) {
    const token = c.req.header('X-Callback-Token')
    if (token !== config.bridgeCallbackToken) {
      log.warn({ hasToken: !!token }, 'bridge callback token mismatch')
      return c.json({ error: 'invalid callback token' }, 401)
    }
  }

  let payload: BridgeCallbackPayload
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  if (payload.event !== 'message.received') {
    log.debug({ event: payload.event }, 'bridge callback event skipped')
    return c.json({ ok: true, skipped: true, reason: `event ${payload.event} not handled` })
  }

  const sessionId = payload.extra?.sessionId
  if (!sessionId) {
    log.warn({ messageId: payload.messageId }, 'bridge callback missing extra.sessionId')
    return c.json({ error: 'missing extra.sessionId' }, 400)
  }

  const session = sessionStore.get(sessionId)
  if (!session) {
    log.warn({ sessionId, messageId: payload.messageId }, 'bridge callback session not found')
    return c.json({ error: `session not found: ${sessionId}` }, 404)
  }

  const prompt = buildPromptFromPayload(payload)

  void sessionManager
    .enqueuePrompt(sessionId, prompt)
    .then(() => {
      log.info(
        { sessionId, messageId: payload.messageId, conversationId: payload.conversationId },
        'bridge message enqueued',
      )
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ err: msg, sessionId, messageId: payload.messageId }, 'bridge message enqueue failed')
    })

  return c.json({ ok: true, messageId: payload.messageId, sessionId })
}

function buildPromptFromPayload(p: BridgeCallbackPayload): string {
  const fromName = p.fromAgentName || p.fromAgentId || 'external-agent'
  const fromId = p.fromAgentId || 'unknown'
  const conv = p.conversationId || 'unknown'
  const ts = p.timestamp ? new Date(p.timestamp).toISOString() : new Date().toISOString()

  const parts: string[] = []
  parts.push(`[来自外部 Agent ${fromName} (agentId=${fromId}, conv=${conv}, time=${ts})]`)
  parts.push('')

  const content = p.content
  if (content.type === 'text' && content.text) {
    parts.push(content.text)
  } else if (content.type === 'json' && content.data !== undefined) {
    parts.push('```json')
    parts.push(JSON.stringify(content.data, null, 2))
    parts.push('```')
  }

  if (content.files && content.files.length > 0) {
    parts.push('')
    parts.push('附件(通过 agent-bridge-server 下载,fileId 见下):')
    for (const f of content.files) {
      parts.push(`- ${f.name} (fileId=${f.fileId}, size=${f.size}, mime=${f.mimeType})`)
    }
  }

  return parts.join('\n')
}
