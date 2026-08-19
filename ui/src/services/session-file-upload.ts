import { getStoredAccessToken } from '../stores/connection.store'
import type { WorkspaceUploadedFile } from '../pages/workspace/workspace-file-attachments'

const UPLOAD_TIMEOUT_MS = 120_000

export async function uploadSessionFile(input: {
  projectId: string
  sessionId: string
  file: File
}): Promise<WorkspaceUploadedFile> {
  const params = new URLSearchParams({
    projectId: input.projectId,
    sessionId: input.sessionId,
    name: input.file.name,
  })
  const headers: Record<string, string> = {
    'Content-Type': input.file.type || 'application/octet-stream',
  }
  const token = getStoredAccessToken().trim()
  if (token) headers['x-ai-ide-token'] = token

  let response: Response
  try {
    response = await fetch(`/api/v1/session-files?${params}`, {
      method: 'POST',
      headers,
      body: input.file,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    if (isAbortError(error)) throw new Error('文件上传超时', { cause: error })
    throw new Error('无法连接文件上传服务', { cause: error })
  }

  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) throw new Error(readUploadError(payload, response.status))
  if (!isUploadResponse(payload)) throw new Error('文件上传响应无效')
  return payload.data
}

function isUploadResponse(value: unknown): value is { data: WorkspaceUploadedFile } {
  if (!value || typeof value !== 'object' || !('data' in value)) return false
  const data = (value as { data?: unknown }).data
  if (!data || typeof data !== 'object') return false
  const record = data as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.mimeType === 'string'
    && typeof record.size === 'number'
    && typeof record.path === 'string'
    && typeof record.relativePath === 'string'
}

function readUploadError(value: unknown, status: number): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return `文件上传失败（HTTP ${status}）`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}
