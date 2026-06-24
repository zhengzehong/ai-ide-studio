import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import type { ReadStream } from 'node:fs'
import { getDbPath } from '../store/db.js'
import type { ImageAttachment } from '../types/ws-protocol.js'

export interface StoredImageAttachment {
  mimeType: string
  name?: string
  relativePath: string
  path: string
  url: string
  size: number
  order: number
}

export interface ImageAsset {
  path: string
  mimeType: string
  size: number
  stream: ReadStream
}

interface SaveSessionImagesInput {
  projectId?: string | null
  sessionId: string
  messageId: string
  images?: ImageAttachment[]
}

interface SaveTaskImagesInput {
  projectId?: string | null
  taskId: string
  images?: ImageAttachment[]
}

interface SaveImagesInput {
  scope: 'sessions' | 'tasks'
  projectId?: string | null
  ownerParts: string[]
  images?: ImageAttachment[]
}

export async function saveSessionImages(input: SaveSessionImagesInput): Promise<StoredImageAttachment[]> {
  return saveImages({
    scope: 'sessions',
    projectId: input.projectId,
    ownerParts: [input.sessionId, input.messageId],
    images: input.images,
  })
}

export async function saveTaskImages(input: SaveTaskImagesInput): Promise<StoredImageAttachment[]> {
  return saveImages({
    scope: 'tasks',
    projectId: input.projectId,
    ownerParts: [input.taskId],
    images: input.images,
  })
}

export function appendHiddenAttachmentNote(content: string, attachments: StoredImageAttachment[]): string {
  if (attachments.length === 0) return content
  const lines = [
    '',
    '[附件说明]',
    '以下图片也已作为 image block 附加给你，你可以直接查看图片内容；如需复制、移动或插入到文档，请使用对应的文件路径。',
  ]
  for (const attachment of attachments) {
    lines.push(
      `附件 ${attachment.order}:`,
      `- 文件路径: ${attachment.path}`,
      `- MIME: ${attachment.mimeType}`,
      `- 原始文件名: ${attachment.name || '未命名图片'}`,
    )
  }
  return `${content}${lines.join('\n')}`
}

export async function loadStoredImagesForAcp(attachments: StoredImageAttachment[]): Promise<ImageAttachment[]> {
  const images: ImageAttachment[] = []
  for (const attachment of attachments) {
    const data = await readFile(attachment.path)
    images.push({
      data: data.toString('base64'),
      mimeType: attachment.mimeType,
      name: attachment.name,
    })
  }
  return images
}

export function imageUrl(relativePath: string): string {
  return `/api/images/${relativePath.split(sep).join('/')}`
}

export function getImageAsset(relativePath: string): ImageAsset | null {
  const normalized = relativePath.replace(/^\/+/, '').split('\\').join('/')
  if (!normalized.startsWith('images/')) return null
  if (normalized.split('/').some((part) => part === '..')) return null

  const dataDir = getDataDir()
  const absolutePath = resolve(dataDir, normalized)
  const imagesRoot = resolve(dataDir, 'images')
  if (absolutePath !== imagesRoot && !absolutePath.startsWith(`${imagesRoot}${sep}`)) return null
  if (!existsSync(absolutePath)) return null
  const stat = statSync(absolutePath)
  if (!stat.isFile()) return null
  return {
    path: absolutePath,
    mimeType: mimeTypeForPath(absolutePath),
    size: stat.size,
    stream: createReadStream(absolutePath),
  }
}

async function saveImages(input: SaveImagesInput): Promise<StoredImageAttachment[]> {
  if (!input.images || input.images.length === 0) return []
  const dataDir = getDataDir()
  const projectId = safeSegment(input.projectId || 'global')
  const ownerParts = input.ownerParts.map(safeSegment)
  const baseRelativeParts = ['images', input.scope, projectId, ...ownerParts]
  const baseDir = resolve(dataDir, ...baseRelativeParts)
  await mkdir(baseDir, { recursive: true })

  const saved: StoredImageAttachment[] = []
  for (const [index, image] of input.images.entries()) {
    const order = index + 1
    const mimeType = image.mimeType || 'application/octet-stream'
    const buffer = Buffer.from(stripDataUrlPrefix(image.data), 'base64')
    const filename = `${String(order).padStart(3, '0')}-${randomUUID()}.${extensionForMime(mimeType)}`
    const relativePath = [...baseRelativeParts, filename].join('/')
    const absolutePath = resolve(dataDir, ...baseRelativeParts, filename)
    await writeFile(absolutePath, buffer)
    saved.push({
      mimeType,
      name: image.name,
      relativePath,
      path: absolutePath,
      url: imageUrl(relativePath),
      size: buffer.length,
      order,
    })
  }
  return saved
}

function getDataDir(): string {
  const dataDir = getDbPath()
  if (!dataDir) throw new Error('Database not initialized. Call initDatabase() first.')
  return dataDir
}

function stripDataUrlPrefix(data: string): string {
  const comma = data.indexOf(',')
  return data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return 'bin'
  }
}

function mimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}
