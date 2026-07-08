import { randomUUID } from 'node:crypto'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { agentStore } from '../../store/agents.js'
import { getDbPath } from '../../store/db.js'
import type { RpcHandlerMap } from './types.js'

const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const MAX_BYTES = 512 * 1024

export const assetRpcHandlers: RpcHandlerMap = {
  async 'assets.upload'(msg, { sendResult }) {
    const agentId = msg.agentId as string
    const base64 = msg.base64 as string
    const ext = (msg.ext as string || 'png').toLowerCase()
    if (!agentId) throw new Error('agentId 不能为空')
    if (!base64) throw new Error('base64 不能为空')
    if (!ALLOWED_EXTS.has(ext)) throw new Error(`不支持的头像格式: ${ext}`)
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`)

    const buffer = Buffer.from(stripDataUrlPrefix(base64), 'base64')
    if (buffer.length === 0) throw new Error('头像数据为空')
    if (buffer.length > MAX_BYTES) throw new Error(`头像过大: ${buffer.length} bytes (上限 ${MAX_BYTES})`)

    const dir = await resolveAvatarDir()
    await removeExistingAvatars(agentId, dir)
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
    const filename = `${agentId}.${normalizedExt}`
    const fullPath = join(dir, filename)
    await writeFile(fullPath, buffer)

    const url = `/avatars/${filename}?t=${Date.now()}`
    sendResult({ url })
  },

  async 'assets.delete'(msg, { sendResult }) {
    const agentId = msg.agentId as string
    if (!agentId) throw new Error('agentId 不能为空')
    const dir = await resolveAvatarDir()
    await removeExistingAvatars(agentId, dir)
    sendResult({ ok: true })
  },

  async 'assets.uploadTemp'(msg, { sendResult }) {
    const base64 = msg.base64 as string
    const ext = (msg.ext as string || 'png').toLowerCase()
    if (!base64) throw new Error('base64 不能为空')
    if (!ALLOWED_EXTS.has(ext)) throw new Error(`不支持的头像格式: ${ext}`)
    const buffer = Buffer.from(stripDataUrlPrefix(base64), 'base64')
    if (buffer.length === 0) throw new Error('头像数据为空')
    if (buffer.length > MAX_BYTES) throw new Error(`头像过大: ${buffer.length} bytes`)

    const dir = await resolveAvatarDir()
    const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
    const tempId = `tmp-${randomUUID().slice(0, 12)}`
    const filename = `${tempId}.${normalizedExt}`
    const fullPath = join(dir, filename)
    await writeFile(fullPath, buffer)
    sendResult({ url: `/avatars/${filename}?t=${Date.now()}`, tempId })
  },
}

async function resolveAvatarDir(): Promise<string> {
  const dbPath = getDbPath()
  if (!dbPath) throw new Error('Database not initialized. Call initDatabase() first.')
  const dir = resolve(dbPath, 'avatars')
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  return dir
}

async function removeExistingAvatars(agentId: string, dir: string): Promise<void> {
  if (!existsSync(dir)) return
  try {
    const files = await readdir(dir)
    for (const file of files) {
      if (file.startsWith(`${agentId}.`)) {
        const fullPath = join(dir, file)
        await unlink(fullPath).catch(() => {})
      }
    }
  } catch {
    // ignore
  }
}

function stripDataUrlPrefix(data: string): string {
  const comma = data.indexOf(',')
  return data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data
}

export function resolveAvatarPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/^\/+/, '').split('\\').join('/')
  if (!normalized.endsWith('.png') && !normalized.endsWith('.jpg') && !normalized.endsWith('.jpeg') && !normalized.endsWith('.webp')) return null
  if (normalized.split('/').some((part) => part === '..')) return null
  const dbPath = getDbPath()
  if (!dbPath) return null
  const avatarsRoot = resolve(dbPath, 'avatars')
  const absolutePath = resolve(dbPath, 'avatars', normalized)
  if (absolutePath !== avatarsRoot && !absolutePath.startsWith(`${avatarsRoot}${sep}`)) return null
  return absolutePath
}
