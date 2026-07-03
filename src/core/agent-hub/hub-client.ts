import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createChildLogger } from '../logger.js'

const log = createChildLogger('agent-hub:http')

const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export interface HubHttpError {
  status: number
  body: unknown
  message: string
}

async function request<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(url, init)
  } catch (e) {
    const err = e as Error
    throw { status: 0, body: null, message: `网络错误: ${err.message}` } satisfies HubHttpError
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!response.ok) {
    const message = typeof parsed === 'object' && parsed && 'detail' in parsed
      ? String((parsed as { detail: unknown }).detail)
      : `HTTP ${response.status}`
    throw { status: response.status, body: parsed, message } satisfies HubHttpError
  }

  return parsed as T
}

export interface RegisterAgentInput {
  localAgentId: string
  name: string
  description: string
  scopeKeys: string[]
  capabilityTags?: string[]
  agentCard?: Record<string, unknown>
}

export interface RegisterResponse {
  registrationId: string
  heartbeatIntervalSec?: number
  transportMode?: string
  agents: Array<{ localAgentId: string; hubAgentId: string; a2aBaseUrl?: string }>
  reused?: boolean
}

export interface SearchAgentInput {
  scopeKeys?: string[]
  match?: 'any' | 'all'
}

export interface SearchAgentResult {
  hubAgentId: string
  localAgentId?: string
  name: string
  description?: string
  scopeKeys?: string[]
  capabilityTags?: string[]
  a2aBaseUrl?: string
  status?: string
  provider?: string
}

export interface SendMessageResponse {
  task: {
    id: string
    contextId?: string
    status: { state: string; timestamp?: string; message?: unknown }
  }
}

export interface UploadFileResult {
  fileId: string
  filename: string
  mediaType: string
  size: number
  url: string
}

interface HubUploadResponse {
  fileId: string
  filename?: string
  mediaType?: string
  size?: number
  url?: string
}

export const hubClient = {
  async register(hubUrl: string, providerToken: string, payload: {
    provider: string
    instanceId: string
    transportMode: 'sse' | 'http'
    publicUrl?: string
    agents: RegisterAgentInput[]
  }): Promise<RegisterResponse> {
    return request<RegisterResponse>('POST', `${hubUrl}/hub/v1/agents/register`, providerToken, payload)
  },

  async unregister(hubUrl: string, providerToken: string, registrationId: string): Promise<void> {
    try {
      await request('DELETE', `${hubUrl}/hub/v1/agents/${registrationId}`, providerToken)
    } catch (e) {
      log.warn({ err: e, registrationId }, 'DELETE 注册失败,继续清理本地状态')
    }
  },

  async search(hubUrl: string, callerToken: string, payload: SearchAgentInput): Promise<SearchAgentResult[]> {
    const result = await request<{ agents?: SearchAgentResult[] } | SearchAgentResult[]>(
      'POST',
      `${hubUrl}/hub/v1/agents/search`,
      callerToken,
      payload,
    )
    if (Array.isArray(result)) return result
    return result.agents ?? []
  },

  async sendMessage(
    hubUrl: string,
    callerToken: string,
    targetHubAgentId: string,
    payload: unknown,
  ): Promise<SendMessageResponse> {
    return request<SendMessageResponse>(
      'POST',
      `${hubUrl}/a2a/agents/${targetHubAgentId}/message:send`,
      callerToken,
      payload,
    )
  },

  async pushResult(pushUrl: string, internalToken: string, payload: unknown): Promise<void> {
    await request('POST', pushUrl, internalToken, payload)
  },

  async uploadFile(
    hubUrl: string,
    token: string,
    filePath: string,
    purpose?: string,
  ): Promise<UploadFileResult> {
    const fileBuffer = await readFile(filePath)
    const filename = basename(filePath)
    const mediaType = inferMimeType(filePath)
    const form = new FormData()
    form.append('file', new Blob([fileBuffer], { type: mediaType }), filename)
    if (purpose) form.append('purpose', purpose)

    let response: Response
    try {
      response = await fetch(`${hubUrl}/hub/v1/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
    } catch (e) {
      const err = e as Error
      throw { status: 0, body: null, message: `uploadFile 网络错误: ${err.message}` } satisfies HubHttpError
    }

    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (!response.ok) {
      const message = typeof parsed === 'object' && parsed && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `uploadFile HTTP ${response.status}`
      throw { status: response.status, body: parsed, message } satisfies HubHttpError
    }

    const data = parsed as HubUploadResponse
    const fileId = data.fileId
    if (!fileId) throw new Error('Hub upload 响应缺少 fileId')
    return {
      fileId,
      filename: data.filename || filename,
      mediaType: data.mediaType || mediaType,
      size: data.size ?? fileBuffer.length,
      url: data.url || `${hubUrl}/hub/v1/files/${fileId}/download`,
    }
  },
}
