export const MAX_SESSION_COMMAND_BYTES = 16 * 1024 * 1024

export interface SessionCommandImage {
  data: string
  mimeType: string
}

export type ElicitationContentValue = string | number | boolean | string[]
export type ElicitationContent = Record<string, ElicitationContentValue>

export type SessionCommand =
  | {
      commandId: string
      type: 'prompt'
      sessionId: string
      clientMessageId: string
      content: string
      contextProjectId?: string
      inspirationNoteId?: string
      originProof?: string
      images?: SessionCommandImage[]
    }
  | {
      commandId: string
      type: 'session.cancel'
      sessionId: string
    }
  | {
      commandId: string
      type: 'sessions.markRead'
      sessionId: string
    }
  | {
      commandId: string
      type: 'sessions.markUnread'
      sessionId: string
    }
  | {
      commandId: string
      type: 'permission.respond'
      sessionId: string
      permissionRequestId: string
      optionId?: string
      cancelled?: boolean
    }
  | {
      commandId: string
      type: 'elicitation.respond'
      sessionId: string
      elicitationRequestId: string
      action: 'accept' | 'decline' | 'cancel'
      content?: ElicitationContent
    }

const BASE_FIELDS = ['commandId', 'type', 'sessionId'] as const

export function parseSessionCommand(
  value: unknown,
  maxBytes = MAX_SESSION_COMMAND_BYTES,
): SessionCommand {
  if (!isRecord(value)) throw new Error('命令请求必须是对象')
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
    throw new Error('命令请求体过大')
  }

  const commandId = requiredText(value.commandId, 'commandId')
  const sessionId = requiredText(value.sessionId, 'sessionId')
  const type = requiredText(value.type, 'type')

  switch (type) {
    case 'prompt':
      assertAllowedFields(value, [
        ...BASE_FIELDS,
        'clientMessageId',
        'content',
        'contextProjectId',
        'inspirationNoteId',
        'originProof',
        'images',
      ])
      return parsePrompt(value, commandId, sessionId)
    case 'session.cancel':
    case 'sessions.markRead':
    case 'sessions.markUnread':
      assertAllowedFields(value, BASE_FIELDS)
      return { commandId, type, sessionId }
    case 'permission.respond':
      assertAllowedFields(value, [
        ...BASE_FIELDS,
        'permissionRequestId',
        'optionId',
        'cancelled',
      ])
      return parsePermission(value, commandId, sessionId)
    case 'elicitation.respond':
      assertAllowedFields(value, [
        ...BASE_FIELDS,
        'elicitationRequestId',
        'action',
        'content',
      ])
      return parseElicitation(value, commandId, sessionId)
    default:
      throw new Error(`不支持的命令: ${type}`)
  }
}

function parsePrompt(
  value: Record<string, unknown>,
  commandId: string,
  sessionId: string,
): Extract<SessionCommand, { type: 'prompt' }> {
  const content = typeof value.content === 'string' ? value.content : requiredText(value.content, 'content')
  const contextProjectId = optionalText(value.contextProjectId, 'contextProjectId')
  const inspirationNoteId = optionalText(value.inspirationNoteId, 'inspirationNoteId')
  const originProof = optionalText(value.originProof, 'originProof')
  if (originProof && originProof.length > 4096) throw new Error('命令来源签名过长')
  const images = parseImages(value.images)
  if (!content.trim() && !images?.length) throw new Error('消息内容或图片不能为空')
  return {
    commandId,
    type: 'prompt',
    sessionId,
    clientMessageId: requiredText(value.clientMessageId, 'clientMessageId'),
    content,
    ...(contextProjectId ? { contextProjectId } : {}),
    ...(inspirationNoteId ? { inspirationNoteId } : {}),
    ...(originProof ? { originProof } : {}),
    ...(images ? { images } : {}),
  }
}

export function resolveSessionCommandMaxBytes(value = process.env.SESSION_COMMAND_MAX_BYTES): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MAX_SESSION_COMMAND_BYTES
}

function parsePermission(
  value: Record<string, unknown>,
  commandId: string,
  sessionId: string,
): Extract<SessionCommand, { type: 'permission.respond' }> {
  const optionId = optionalText(value.optionId, 'optionId')
  if (value.cancelled !== undefined && typeof value.cancelled !== 'boolean') {
    throw new Error('cancelled 必须是布尔值')
  }
  return {
    commandId,
    type: 'permission.respond',
    sessionId,
    permissionRequestId: requiredText(value.permissionRequestId, 'permissionRequestId'),
    ...(optionId ? { optionId } : {}),
    ...(value.cancelled === undefined ? {} : { cancelled: value.cancelled }),
  }
}

function parseElicitation(
  value: Record<string, unknown>,
  commandId: string,
  sessionId: string,
): Extract<SessionCommand, { type: 'elicitation.respond' }> {
  if (value.action !== 'accept' && value.action !== 'decline' && value.action !== 'cancel') {
    throw new Error('action 必须是 accept、decline 或 cancel')
  }
  const content = parseElicitationContent(value.content)
  return {
    commandId,
    type: 'elicitation.respond',
    sessionId,
    elicitationRequestId: requiredText(value.elicitationRequestId, 'elicitationRequestId'),
    action: value.action,
    ...(content ? { content } : {}),
  }
}

function parseImages(value: unknown): SessionCommandImage[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('images 必须是图片数组')
  return value.map((item) => {
    if (!isRecord(item)) throw new Error('图片数据无效')
    const data = requiredText(item.data, '图片 data')
    const mimeType = requiredText(item.mimeType, '图片 mimeType')
    if (!mimeType.startsWith('image/')) throw new Error('图片 mimeType 无效')
    assertAllowedFields(item, ['data', 'mimeType'])
    return { data, mimeType }
  })
}

function parseElicitationContent(value: unknown): ElicitationContent | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('提问响应 content 必须是对象')
  const result: ElicitationContent = {}
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== 'string'
      && typeof item !== 'number'
      && typeof item !== 'boolean'
      && !(Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
    ) {
      throw new Error(`提问响应字段 ${key} 无效`)
    }
    result[key] = item
  }
  return result
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedFields = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedFields.has(key))
  if (unknown) throw new Error(`命令包含未知字段: ${unknown}`)
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} 为必填字符串`)
  return value
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  return requiredText(value, name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
