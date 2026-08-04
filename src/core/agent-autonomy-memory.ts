import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { getDbPath } from '../store/db.js'

const MAX_MEMORY_PREVIEW_BYTES = 1024 * 1024
const INITIAL_MEMORY = `# 工作记忆

## 当前状态

## 已完成

## 关键结论

## 下一步
`

export interface AutonomyMemoryData {
  path: string
  content: string
  updatedAt: string | null
  truncated: boolean
}

export function autonomyMemoryPath(projectId: string, agentId: string): string {
  return resolve(dirname(getDbPath()), 'autonomy', safeSegment(projectId), safeSegment(agentId), 'memory.md')
}

export function ensureAutonomyMemory(projectId: string, agentId: string): AutonomyMemoryData {
  const path = autonomyMemoryPath(projectId, agentId)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, INITIAL_MEMORY, 'utf8')
  }
  return readAutonomyMemory(projectId, agentId)
}

export function readAutonomyMemory(projectId: string, agentId: string): AutonomyMemoryData {
  const path = autonomyMemoryPath(projectId, agentId)
  if (!existsSync(path)) return { path, content: '', updatedAt: null, truncated: false }
  const stat = statSync(path)
  const buffer = readFileSync(path)
  const truncated = buffer.byteLength > MAX_MEMORY_PREVIEW_BYTES
  const content = truncated
    ? new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, MAX_MEMORY_PREVIEW_BYTES))
    : buffer.toString('utf8')
  return {
    path,
    content,
    updatedAt: stat.mtime.toISOString(),
    truncated,
  }
}

export function readAutonomyMemoryMetadata(projectId: string, agentId: string): AutonomyMemoryData {
  const path = autonomyMemoryPath(projectId, agentId)
  if (!existsSync(path)) return { path, content: '', updatedAt: null, truncated: false }
  const stat = statSync(path)
  return {
    path,
    content: '',
    updatedAt: stat.mtime.toISOString(),
    truncated: stat.size > MAX_MEMORY_PREVIEW_BYTES,
  }
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
  if (!cleaned) throw new Error('自主记忆路径标识不能为空')
  return cleaned
}
