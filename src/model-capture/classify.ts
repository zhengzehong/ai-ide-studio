import { getDb } from '../store/db.js'

/** 从请求体提取会话/轮次标识,并反查平台会话(claude: metadata.user_id;codex: client_metadata)。 */

export type CaptureRuntimeHint = 'claude' | 'codex' | 'unknown'

export interface CaptureIdentity {
  sessionUuid?: string
  turnId?: string
  runtimeHint: CaptureRuntimeHint
}

export interface CaptureSessionInfo {
  sessionId: string
  agentId: string
  sessionTitle: string | null
}

const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g

interface CodexClientMetadata {
  session_id?: unknown
  thread_id?: unknown
  prompt_cache_key?: unknown
  turn_id?: unknown
}

interface ClaudeMetadata {
  user_id?: unknown
}

export function extractCaptureIdentity(body: unknown): CaptureIdentity {
  if (!body || typeof body !== 'object') return { runtimeHint: 'unknown' }
  const record = body as Record<string, unknown>

  const clientMetadata = readObject(record['client_metadata']) as CodexClientMetadata | undefined
  if (clientMetadata) {
    const sessionUuid = readUuid(clientMetadata['session_id'])
      ?? readUuid(clientMetadata['thread_id'])
      ?? readUuid(clientMetadata['prompt_cache_key'])
    if (sessionUuid) {
      return {
        sessionUuid,
        turnId: readTrimmed(clientMetadata['turn_id']),
        runtimeHint: 'codex',
      }
    }
  }

  const claudeMetadata = readObject(record['metadata']) as ClaudeMetadata | undefined
  const userId = claudeMetadata ? readTrimmed(claudeMetadata['user_id']) : undefined
  if (userId) {
    const matches = userId.match(UUID_PATTERN)
    const sessionUuid = matches ? matches[matches.length - 1] : undefined
    if (sessionUuid) return { sessionUuid, runtimeHint: 'claude' }
  }

  return { runtimeHint: 'unknown' }
}

/** 反查平台会话;查不到返回 null(调用方落 _unattributed)。 */
export function lookupSessionByAcpUuid(sessionUuid: string): CaptureSessionInfo | null {
  const row = getDb().prepare<[string], { id: string; title: string | null; agent_id: string }>(
    'SELECT id, title, agent_id FROM sessions WHERE acp_session_id = ?',
  ).get(sessionUuid)
  if (!row) return null
  return { sessionId: row.id, agentId: row.agent_id, sessionTitle: row.title }
}

/** 从转发路径判断请求种类(决定落盘文件名)。 */
export type CaptureKind = 'messages' | 'count_tokens' | 'responses' | 'probe' | 'other'

/**
 * 请求分型。claude 非流式探测与流式正式请求路径相同(/v1/messages),需看 body.stream 区分:
 * stream===true → 'messages'(计数类);否则 'probe'(探测,落盘但不占每会话保留额度)。
 */
export function detectCaptureKind(path: string, body?: unknown): CaptureKind {
  if (path.endsWith('/count_tokens')) return 'count_tokens'
  if (path.endsWith('/responses')) return 'responses'
  if (path.includes('/messages')) {
    return isStreamTrue(body) ? 'messages' : 'probe'
  }
  return 'other'
}

function isStreamTrue(body: unknown): boolean {
  return !!body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>)['stream'] === true
}

/** x-api-key / Authorization 等鉴权头打码。 */
export function maskSensitiveHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const joined = Array.isArray(value) ? value.join(', ') : value
    masked[key.toLowerCase()] = /api-key|authorization|token|cookie/i.test(key)
      ? maskSecret(joined)
      : joined
  }
  return masked
}

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readUuid(value: unknown): string | undefined {
  const trimmed = readTrimmed(value)
  if (!trimmed) return undefined
  const exact = trimmed.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  if (exact) return exact[0]
  const matches = trimmed.match(UUID_PATTERN)
  return matches ? matches[matches.length - 1] : undefined
}
