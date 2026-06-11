import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export type ImportableLocalRuntime = 'codex' | 'claude'

export interface LocalSessionCandidate {
  runtime: ImportableLocalRuntime
  sessionId: string
  path: string
  label: string
  updatedAt: string
  cwd?: string
}

export interface LocalSessionScanOptions {
  runtime: ImportableLocalRuntime
  cwd?: string
  codexHome?: string
  claudeHome?: string
  limit?: number
}

const MAX_PARSE_LINES = 20
const MAX_PARSE_BYTES = 1024 * 1024
const MAX_SCAN_FILES = 500
const READ_CHUNK_SIZE = 64 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseLocalSessionFile(filePath: string): LocalSessionCandidate {
  const path = resolve(filePath)
  if (!path.toLowerCase().endsWith('.jsonl')) throw new Error('仅支持导入 .jsonl 文件')
  if (!existsSync(path)) throw new Error(`本地会话文件不存在: ${path}`)

  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`本地会话路径不是文件: ${path}`)

  const lines = readHeadLines(path, MAX_PARSE_LINES)
  const records = lines.map(parseLine).filter(isRecord)
  const codex = parseCodexRecord(records, path, stat.mtime)
  if (codex) return codex
  const claude = parseClaudeRecord(records, path, stat.mtime)
  if (claude) return claude
  throw new Error('无法识别本地会话文件，请确认是 Codex 或 Claude Code 的 JSONL')
}

function readHeadLines(path: string, limit: number): string[] {
  const fd = openSync(path, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.allocUnsafe(READ_CHUNK_SIZE)
  const lines: string[] = []
  let pending = ''
  let bytesReadTotal = 0
  try {
    while (lines.length < limit && bytesReadTotal < MAX_PARSE_BYTES) {
      const nextReadSize = Math.min(buffer.length, MAX_PARSE_BYTES - bytesReadTotal)
      const bytesRead = readSync(fd, buffer, 0, nextReadSize, null)
      if (bytesRead === 0) break
      bytesReadTotal += bytesRead
      pending += decoder.write(buffer.subarray(0, bytesRead))
      pending = collectCompleteLines(pending, lines, limit)
    }
    pending += decoder.end()
    collectFinalLine(pending, lines, limit)
    return lines
  } finally {
    closeSync(fd)
  }
}

function collectCompleteLines(input: string, lines: string[], limit: number): string {
  let pending = input
  let newlineIndex = pending.indexOf('\n')
  while (newlineIndex >= 0 && lines.length < limit) {
    const line = pending.slice(0, newlineIndex).replace(/\r$/, '')
    if (line) lines.push(line)
    pending = pending.slice(newlineIndex + 1)
    newlineIndex = pending.indexOf('\n')
  }
  return pending
}

function collectFinalLine(input: string, lines: string[], limit: number): void {
  if (lines.length >= limit) return
  const line = input.replace(/\r$/, '')
  if (line) lines.push(line)
}

export function validateLocalSessionRuntime(candidate: LocalSessionCandidate, runtime: string): void {
  if (candidate.runtime !== runtime) {
    throw new Error(`本地会话 runtime 为 ${candidate.runtime}，不能导入到 ${runtime} Agent`)
  }
}

export function listLocalSessionCandidates(options: LocalSessionScanOptions): LocalSessionCandidate[] {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100))
  const files = options.runtime === 'codex'
    ? listCodexFiles(options.codexHome ?? join(homedir(), '.codex'))
    : listClaudeFiles(options.claudeHome ?? join(homedir(), '.claude'), options.cwd)

  const candidates: LocalSessionCandidate[] = []
  for (const file of files.slice(0, MAX_SCAN_FILES)) {
    try {
      const candidate = parseLocalSessionFile(file)
      if (candidate.runtime === options.runtime) candidates.push(candidate)
    } catch {
      // Ignore unrelated or partially-written JSONL files while scanning.
    }
  }

  return candidates
    .sort((a, b) => compareCandidates(a, b, options.cwd))
    .slice(0, limit)
}

export function localSessionCwdWarning(candidate: LocalSessionCandidate, cwd?: string): string | undefined {
  if (!candidate.cwd || !cwd) return undefined
  return normalizePath(candidate.cwd) === normalizePath(cwd)
    ? undefined
    : `本地会话工作目录为 ${candidate.cwd}，当前项目目录为 ${cwd}`
}

function parseCodexRecord(records: Record<string, unknown>[], path: string, mtime: Date): LocalSessionCandidate | undefined {
  const meta = records.find((record) => record.type === 'session_meta' && isRecord(record.payload))
  const payload = meta?.payload as Record<string, unknown> | undefined
  const sessionId = typeof payload?.id === 'string' && payload.id.trim() ? payload.id.trim() : undefined
  if (!sessionId) return undefined
  const cwd = typeof payload?.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : undefined
  return buildCandidate('codex', sessionId, path, mtime, cwd)
}

function parseClaudeRecord(records: Record<string, unknown>[], path: string, mtime: Date): LocalSessionCandidate | undefined {
  const record = records.find((item) => typeof item.sessionId === 'string' || typeof item.session_id === 'string')
  const rawSessionId = typeof record?.sessionId === 'string'
    ? record.sessionId
    : typeof record?.session_id === 'string'
      ? record.session_id
      : undefined
  const fallback = basename(path, '.jsonl')
  const sessionId = rawSessionId?.trim() || (UUID_RE.test(fallback) ? fallback : undefined)
  if (!sessionId) return undefined
  const cwd = findString(records, ['cwd', 'projectCwd', 'project_dir', 'projectDir'])
  return buildCandidate('claude', sessionId, path, mtime, cwd)
}

function buildCandidate(
  runtime: ImportableLocalRuntime,
  sessionId: string,
  path: string,
  mtime: Date,
  cwd?: string,
): LocalSessionCandidate {
  return {
    runtime,
    sessionId,
    path,
    cwd,
    label: `${runtime === 'codex' ? 'Codex' : 'Claude Code'} ${shortId(sessionId)}`,
    updatedAt: mtime.toISOString(),
  }
}

function listCodexFiles(codexHome: string): string[] {
  const roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')]
  return roots.flatMap((root) => walkJsonl(root))
}

function listClaudeFiles(claudeHome: string, cwd?: string): string[] {
  const projectsRoot = join(claudeHome, 'projects')
  if (!cwd) return walkJsonl(projectsRoot)
  const encoded = encodeClaudeProjectPath(cwd)
  const preferred = walkJsonl(join(projectsRoot, encoded))
  const seen = new Set(preferred)
  const rest = walkJsonl(projectsRoot).filter((file) => !seen.has(file))
  return [...preferred, ...rest]
}

function walkJsonl(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const pending = [root]
  while (pending.length > 0 && out.length < MAX_SCAN_FILES) {
    const dir = pending.pop()
    if (!dir) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      let stats
      try {
        stats = statSync(path)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        pending.push(path)
      } else if (stats.isFile() && entry.toLowerCase().endsWith('.jsonl')) {
        out.push(path)
      }
      if (out.length >= MAX_SCAN_FILES) break
    }
  }
  return out
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function findString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return undefined
}

function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function compareCandidates(a: LocalSessionCandidate, b: LocalSessionCandidate, cwd?: string): number {
  if (cwd) {
    const normalizedCwd = normalizePath(cwd)
    const aMatches = a.cwd ? normalizePath(a.cwd) === normalizedCwd : false
    const bMatches = b.cwd ? normalizePath(b.cwd) === normalizedCwd : false
    if (aMatches !== bMatches) return aMatches ? -1 : 1
  }
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

function shortId(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 8)
}
