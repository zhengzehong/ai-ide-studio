import { getStoredAccessToken } from '../stores/connection.store'
import { wsClient } from './ws-client'
import { getElectronDesktopBridge } from './electron-desktop'

export interface BrowserCommandImage {
  data: string
  mimeType: string
  name?: string
  url?: string
  relativePath?: string
  path?: string
  size?: number
  order?: number
}

export interface BrowserImageInput extends Omit<BrowserCommandImage, 'data'> {
  data?: string
}

export type BrowserSessionCommand =
  | { commandId: string; type: 'prompt'; sessionId: string; clientMessageId: string; content: string; contextProjectId?: string; inspirationNoteId?: string; images?: BrowserCommandImage[]; originProof?: string }
  | { commandId: string; type: 'session.cancel'; sessionId: string }
  | { commandId: string; type: 'session.forceFinish'; sessionId: string }
  | { commandId: string; type: 'sessions.markRead'; sessionId: string }
  | { commandId: string; type: 'sessions.markUnread'; sessionId: string }
  | { commandId: string; type: 'permission.respond'; sessionId: string; permissionRequestId: string; optionId?: string; cancelled?: boolean }
  | { commandId: string; type: 'elicitation.respond'; sessionId: string; elicitationRequestId: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean | string[]> }

export interface CommandReceipt {
  commandId: string
  status: 'accepted' | 'completed'
  duplicate: boolean
}

export interface CommandClient {
  execute(command: BrowserSessionCommand): Promise<CommandReceipt>
}

export interface HttpCommandClientOptions {
  fetchImpl?: typeof fetch
  getAccessToken?: () => string
  subscribe?: (sessionIds: string[]) => void
  timeoutMs?: number
  maxCommandBytes?: number
}

export interface WsCommandClientOptions {
  send?: (message: Record<string, unknown>) => void
  request?: (message: Record<string, unknown>) => Promise<unknown>
  subscribe?: (sessionIds: string[]) => void
}

type CommandTransport = 'http' | 'ws'
const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_SESSION_COMMAND_MAX_BYTES = 16 * 1024 * 1024

export function createHttpCommandClient(options: HttpCommandClientOptions = {}): CommandClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const getAccessToken = options.getAccessToken ?? getStoredAccessToken
  const subscribe = options.subscribe ?? ((sessionIds) => wsClient.subscribe(sessionIds))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxCommandBytes = options.maxCommandBytes ?? DEFAULT_SESSION_COMMAND_MAX_BYTES
  return {
    async execute(command) {
      const origin = desktopOriginProof(command)
      if (origin && command.type === 'prompt') command = { ...command, originProof: await origin }
      const serialized = JSON.stringify(command)
      if (new TextEncoder().encode(serialized).byteLength > maxCommandBytes) {
        throw new Error(`消息和图片总大小超过限制（最大 ${formatBytes(maxCommandBytes)}）`)
      }
      if (command.type === 'prompt') subscribe([command.sessionId])
      const token = getAccessToken().trim()
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': command.commandId,
      }
      if (token) headers['x-ai-ide-token'] = token
      let response: Response
      try {
        response = await fetchImpl('/api/v1/commands', {
          method: 'POST',
          headers,
          body: serialized,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        if (isAbortError(error)) throw new Error('命令请求超时', { cause: error })
        throw error
      }
      const body = await response.json().catch(() => null) as unknown
      if (!response.ok) throw new Error(responseError(body, response.status))
      return parseReceipt(body)
    },
  }
}

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`
}

export function createWsCommandClient(options: WsCommandClientOptions = {}): CommandClient {
  const send = options.send ?? ((message) => wsClient.send(message))
  const request = options.request ?? ((message) => wsClient.request(message))
  const subscribe = options.subscribe ?? ((sessionIds) => wsClient.subscribe(sessionIds))
  return {
    async execute(command) {
      const origin = desktopOriginProof(command)
      if (origin && command.type === 'prompt') command = { ...command, originProof: await origin }
      const frame = legacyFrame(command)
      if (command.type === 'prompt') {
        subscribe([command.sessionId])
        send(frame)
      } else {
        await request(frame)
      }
      return { commandId: command.commandId, status: command.type === 'prompt' ? 'accepted' : 'completed', duplicate: false }
    },
  }
}

export function resolveCommandTransport(mode: string, configured?: string): CommandTransport {
  if (mode === 'test') return 'ws'
  return configured?.trim().toLowerCase() === 'ws' ? 'ws' : 'http'
}

const selectedTransport = resolveCommandTransport(
  import.meta.env.MODE,
  import.meta.env.VITE_COMMAND_TRANSPORT as string | undefined,
)

export const commandClient: CommandClient = selectedTransport === 'ws'
  ? createWsCommandClient()
  : createHttpCommandClient()

export function toCommandImages(images?: BrowserImageInput[]): BrowserCommandImage[] | undefined {
  const inline = images
    ?.filter((image): image is BrowserCommandImage => typeof image.data === 'string' && image.data.length > 0)
    .map((image) => ({ ...image }))
  return inline && inline.length > 0 ? inline : undefined
}

function legacyFrame(command: BrowserSessionCommand): Record<string, unknown> {
  switch (command.type) {
    case 'prompt':
      return compact({
        type: 'prompt',
        sessionId: command.sessionId,
        clientMessageId: command.clientMessageId,
        content: command.content,
        contextProjectId: command.contextProjectId,
        inspirationNoteId: command.inspirationNoteId,
        originProof: command.originProof,
        images: command.images,
      })
    case 'session.cancel':
    case 'session.forceFinish':
    case 'sessions.markRead':
    case 'sessions.markUnread':
      return { type: command.type, sessionId: command.sessionId }
    case 'permission.respond':
      return compact({
        type: command.type,
        sessionId: command.sessionId,
        permissionRequestId: command.permissionRequestId,
        optionId: command.optionId,
        cancelled: command.cancelled,
      })
    case 'elicitation.respond':
      return compact({
        type: command.type,
        sessionId: command.sessionId,
        elicitationRequestId: command.elicitationRequestId,
        action: command.action,
        content: command.content,
      })
  }
}

function parseReceipt(value: unknown): CommandReceipt {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error('命令响应无效')
  const { commandId, status, duplicate } = value.data
  if (typeof commandId !== 'string'
    || (status !== 'accepted' && status !== 'completed')
    || typeof duplicate !== 'boolean') {
    throw new Error('命令响应无效')
  }
  return { commandId, status, duplicate }
}

function responseError(value: unknown, status: number): string {
  return isRecord(value) && typeof value.error === 'string'
    ? value.error
    : `命令执行失败（HTTP ${status}）`
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function desktopOriginProof(command: BrowserSessionCommand): Promise<string | undefined> | undefined {
  if (command.type !== 'prompt' || typeof window === 'undefined') return undefined
  const bridge = getElectronDesktopBridge()
  return bridge?.signOrigin?.({ sessionId: command.sessionId, messageId: command.clientMessageId })
}
