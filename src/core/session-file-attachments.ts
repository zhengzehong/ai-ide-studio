import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDbPath } from '../store/db.js'

export const DEFAULT_SESSION_FILE_MAX_BYTES = 50 * 1024 * 1024
const MAX_FILE_NAME_LENGTH = 180
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export interface StoredSessionFile {
  id: string
  name: string
  mimeType: string
  size: number
  relativePath: string
  path: string
}

export interface SaveSessionFileInput {
  projectId: string
  sessionId: string
  fileName: string
  mimeType: string
  body: ReadableStream<Uint8Array> | null
  contentLength?: number
  maxBytes?: number
}

export class SessionFileUploadError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) {
    super(message)
    this.name = 'SessionFileUploadError'
  }
}

export async function saveSessionFile(input: SaveSessionFileInput): Promise<StoredSessionFile> {
  const name = validateFileName(input.fileName)
  if (!input.body) throw new SessionFileUploadError('文件内容不能为空')
  const maxBytes = input.maxBytes ?? DEFAULT_SESSION_FILE_MAX_BYTES
  if (input.contentLength !== undefined && input.contentLength > maxBytes) {
    throw new SessionFileUploadError(`文件超过 ${formatMiB(maxBytes)} MiB 限制`, 413)
  }

  const dataDir = getDbPath()
  if (!dataDir) throw new Error('Database not initialized. Call initDatabase() first.')
  const id = randomUUID()
  const relativeParts = [
    'attachments',
    'sessions',
    safeSegment(input.projectId),
    safeSegment(input.sessionId),
    id,
  ]
  const directory = resolve(dataDir, ...relativeParts)
  const temporaryPath = resolve(directory, '.uploading')
  const path = resolve(directory, name)
  const reader = input.body.getReader()
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let size = 0

  try {
    await mkdir(directory, { recursive: true })
    handle = await open(temporaryPath, 'wx')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new SessionFileUploadError(`文件超过 ${formatMiB(maxBytes)} MiB 限制`, 413)
      await handle.write(value)
    }
    if (size === 0) throw new SessionFileUploadError('文件内容不能为空')
    await handle.close()
    handle = undefined
    await rename(temporaryPath, path)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await reader.cancel().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
    throw error
  } finally {
    reader.releaseLock()
  }

  return {
    id,
    name,
    mimeType: normalizeMimeType(input.mimeType),
    size,
    relativePath: [...relativeParts, name].join('/'),
    path,
  }
}

function validateFileName(value: string): string {
  const name = value.trim()
  if (!name || name.length > MAX_FILE_NAME_LENGTH) throw new SessionFileUploadError('文件名无效或过长')
  if (
    name === '.'
    || name === '..'
    || name.endsWith('.')
    || /[<>:"/\\|?*]/.test(name)
    || hasControlCharacter(name)
    || WINDOWS_RESERVED_NAME.test(name)
  ) {
    throw new SessionFileUploadError('文件名包含不允许的字符')
  }
  return name
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

function normalizeMimeType(value: string): string {
  const mimeType = value.split(';', 1)[0].trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)
    ? mimeType
    : 'application/octet-stream'
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function formatMiB(bytes: number): number {
  return Math.ceil(bytes / (1024 * 1024))
}
