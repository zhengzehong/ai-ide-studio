import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'path'
import { createChildLogger } from '../core/logger.js'
import { DEFAULT_CAPTURE_MAX_PER_SESSION } from './capture-config.js'
import { captureMemoryBudget, type CaptureTruncationReason } from './capture-memory-budget.js'

/** 抓包落盘:data/captures/<YYYY-MM-DD>/<sess-会话|_unattributed>/<HHmmss>-<seq>-<kind>.json,tmp→rename 原子落盘。 */

const log = createChildLogger('capture-store')

export type CaptureTerminalStatus = 'completed' | 'client_aborted' | 'upstream_error' | 'timeout' | 'proxy_restart'

export interface CapturePlatformInfo {
  sessionId?: string
  agentId: string
  runtime: string
  sessionTitle?: string | null
  turnId?: string
}

export interface CaptureRecord {
  ts: string
  finishedAt?: string
  durationMs?: number
  status?: number
  terminalStatus?: CaptureTerminalStatus
  error?: string
  truncated?: boolean
  truncationReason?: CaptureTruncationReason
  kind: string
  platform: CapturePlatformInfo
  model?: string
  provider?: string
  requestHeaders: Record<string, string>
  request: unknown
  response: {
    sse: string[]
    text: string
    usage?: Record<string, unknown>
  }
}

export interface CaptureWriter {
  readonly finalPath: string
  readonly tmpPath: string
  appendResponseChunk(text: string): void
  /** 非流式(JSON)响应体按原文累积到 response.text,不进 sse。 */
  appendTextChunk(text: string): void
  setStatus(status: number): void
  setError(message: string): void
  finalize(terminalStatus: CaptureTerminalStatus): Promise<void>
}

let seqCounter = 0
const pendingFinalizes = new Set<Promise<void>>()

export function captureRoot(dataDir: string): string {
  return join(dataDir, 'captures')
}

export function beginCapture(
  root: string,
  input: {
    kind: string
    platform: CapturePlatformInfo
    model?: string
    provider?: string
    requestHeaders: Record<string, string>
    request: unknown
    /** finalize 后按此上限清理会话目录最老文件(仅数计数类 kind,.tmp 不计不清)。 */
    maxPerSession?: number
  },
): CaptureWriter {
  const dir = sessionDir(root, input.platform.sessionId)
  mkdirSync(dir, { recursive: true })
  const maxPerSession = input.maxPerSession ?? DEFAULT_CAPTURE_MAX_PER_SESSION
  const requestCost = 512 + (JSON.stringify(input.request)?.length ?? 0) * 2
  const budget = captureMemoryBudget.open()
  const requestTruncation = budget.retain(requestCost)
  const record: CaptureRecord = {
    ts: new Date().toISOString(),
    kind: input.kind,
    platform: input.platform,
    ...(input.model ? { model: input.model } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    requestHeaders: input.requestHeaders,
    request: requestTruncation ? null : input.request,
    response: { sse: [], text: '' },
  }
  const finalPath = join(dir, `${fileNamePrefix()}-${input.kind}.json`)
  const tmpPath = `${finalPath}.tmp`
  let status: number | undefined
  let error: string | undefined
  let finalizing: Promise<void> | undefined
  const truncate = (reason: CaptureTruncationReason): void => {
    record.truncated = true
    record.truncationReason = reason
    log.warn({ ...record.platform, reason }, 'Capture memory limit reached; remaining capture omitted')
  }
  if (requestTruncation) truncate(requestTruncation)

  const finalize = (terminalStatus: CaptureTerminalStatus): Promise<void> => {
    if (finalizing) return finalizing
    record.terminalStatus = terminalStatus
    record.finishedAt = new Date().toISOString()
    if (status !== undefined) record.status = status
    if (error !== undefined) record.error = error
    finalizing = Promise.resolve().then(async () => {
      if (record.response.sse.length > 0) {
        const assembled = assembleSse(record.response.sse)
        record.response.text = assembled.text
        if (assembled.usage) record.response.usage = assembled.usage
      }
      await writeFile(tmpPath, JSON.stringify(record), 'utf8')
      renameSync(tmpPath, finalPath)
      log.debug({ ...record.platform, terminalStatus, truncated: record.truncated }, 'Capture finalized')
      enforceSessionFileLimit(dir, maxPerSession)
    }).catch((err: unknown) => {
      log.warn({ err, tmpPath }, '抓包终态落盘失败')
    }).finally(() => {
      record.request = null
      record.response = { sse: [], text: '' }
      budget.release()
    })
    trackFinalize(finalizing)
    return finalizing
  }

  const retainChunk = (text: string): boolean => {
    if (finalizing || record.truncated) return false
    // Include UTF-16 storage, assembled text and per-chunk bookkeeping, even for tiny chunks.
    const reason = budget.retain(text.length * 4 + 64)
    if (reason) truncate(reason)
    return !reason
  }

  return {
    finalPath,
    tmpPath,
    appendResponseChunk(text) {
      if (!retainChunk(text)) return
      record.response.sse.push(text)
    },
    appendTextChunk(text) {
      if (!retainChunk(text)) return
      record.response.text += text
    },
    setStatus(value) { if (!finalizing) status = value },
    setError(message) { if (!finalizing) error = message },
    finalize,
  }
}

/** 进程重启后扫描未完成 .tmp,补 proxy_restart 终态(保留已收内容)。 */
export function recoverPendingCaptures(root: string): number {
  if (!existsSync(root)) return 0
  let recovered = 0
  for (const day of listDirs(root)) {
    for (const session of listDirs(join(root, day))) {
      const dir = join(root, day, session)
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json.tmp')) continue
        const tmpPath = join(dir, name)
        try {
          const parsed = JSON.parse(readTextSafe(tmpPath)) as CaptureRecord
          parsed.terminalStatus = 'proxy_restart'
          parsed.finishedAt = parsed.finishedAt ?? new Date().toISOString()
          const finalPath = tmpPath.replace(/\.tmp$/, '')
          writeFileSync(tmpPath, JSON.stringify(parsed), 'utf8')
          renameSync(tmpPath, finalPath)
          recovered += 1
        } catch (err) {
          log.warn({ err, tmpPath }, '抓包 tmp 恢复失败,保留 .tmp 供人工检查')
        }
      }
    }
  }
  if (recovered > 0) log.info({ recovered }, '已补齐重启前的抓包文件')
  return recovered
}

/** 按保留天数清理:整天目录删除。 */
export function cleanupExpiredCaptures(root: string, retentionDays: number): number {
  if (!existsSync(root)) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const day of listDirs(root)) {
    const dayMs = Date.parse(`${day}T00:00:00Z`)
    if (Number.isNaN(dayMs) || dayMs >= cutoff) continue
    try {
      rmSync(join(root, day), { recursive: true, force: true })
      removed += 1
    } catch (err) {
      log.warn({ err, day }, '抓包过期目录清理失败')
    }
  }
  if (removed > 0) log.info({ removed, retentionDays }, '已清理过期抓包目录')
  return removed
}

/**
 * 每会话目录保留最新 maxPerSession 个「计数类」已落盘 .json(文件名 HHmmss-seq 字典序=时间序,删最老)。
 * 计数口径:仅正式请求 messages/responses 占额度;count_tokens/探测照常落盘但不占额度、绝不被清理。
 * 红线:.json.tmp 正在写入,不计入数量、绝不清理。失败只 warn 不抛出。
 */
export function enforceSessionFileLimit(sessionDirPath: string, maxPerSession: number): number {
  if (maxPerSession < 1 || !existsSync(sessionDirPath)) return 0
  let names: string[]
  try {
    names = readdirSync(sessionDirPath)
  } catch (err) {
    log.warn({ err, dir: sessionDirPath }, '会话抓包目录列出失败')
    return 0
  }
  // 只统计已 finalize 且计数类的 .json;'.json.tmp' 不以 .json 结尾,天然排除
  const counted = names
    .filter((name) => name.endsWith('.json') && isCountedKindFileName(name))
    .sort()
  const overflow = counted.length - maxPerSession
  if (overflow <= 0) return 0
  let removed = 0
  for (const name of counted.slice(0, overflow)) {
    try {
      rmSync(join(sessionDirPath, name), { force: true })
      removed += 1
    } catch (err) {
      log.warn({ err, dir: sessionDirPath, name }, '会话抓包超限清理失败')
    }
  }
  if (removed > 0) log.info({ removed, dir: sessionDirPath, maxPerSession }, '会话抓包超限,已清理最老文件')
  return removed
}

/** 文件名格式 HHmmss-seq-<kind>.json;kind 不含连字符,取末段判断是否计数类。 */
function isCountedKindFileName(name: string): boolean {
  const kind = name.slice(0, -'.json'.length).split('-').pop() ?? ''
  return kind === 'messages' || kind === 'responses'
}

/** SSE 事件数组 → 重组文本 + usage(best-effort,claude/codex 双格式)。 */
export function assembleSse(events: string[]): { text: string; usage?: Record<string, unknown> } {
  let text = ''
  let usage: Record<string, unknown> | undefined
  for (const raw of events) {
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: unknown
      try { parsed = JSON.parse(payload) } catch { continue }
      const extracted = extractFromEvent(parsed)
      if (extracted.text) text += extracted.text
      if (extracted.usage) usage = extracted.usage
    }
  }
  return { text, ...(usage ? { usage } : {}) }
}

function extractFromEvent(parsed: unknown): { text?: string; usage?: Record<string, unknown> } {
  if (!parsed || typeof parsed !== 'object') return {}
  const event = parsed as Record<string, unknown>
  const type = typeof event['type'] === 'string' ? event['type'] : ''
  if (type === 'content_block_delta') {
    const delta = event['delta']
    if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
      const d = delta as Record<string, unknown>
      if (typeof d['text'] === 'string') return { text: d['text'] }
    }
  }
  if (type === 'response.output_text.delta' && typeof event['delta'] === 'string') {
    return { text: event['delta'] }
  }
  const usage = findUsage(event, new Set())
  return usage ? { usage } : {}
}

function findUsage(value: unknown, seen: Set<object>): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (seen.has(value as object)) return undefined
  seen.add(value as object)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUsage(item, seen)
      if (found) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  if (record['usage'] && typeof record['usage'] === 'object' && !Array.isArray(record['usage'])) {
    return record['usage'] as Record<string, unknown>
  }
  for (const child of Object.values(record)) {
    const found = findUsage(child, seen)
    if (found) return found
  }
  return undefined
}

function sessionDir(root: string, sessionId: string | undefined): string {
  return sessionId
    ? join(root, dayFolder(), `sess-${sessionId.replace(/^sess-/, '')}`)
    : join(root, dayFolder(), '_unattributed')
}

function dayFolder(): string {
  return new Date().toISOString().slice(0, 10)
}

function fileNamePrefix(): string {
  seqCounter += 1
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}${mm}${ss}-${String(seqCounter).padStart(4, '0')}`
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function readTextSafe(path: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) return ''
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

function trackFinalize(promise: Promise<void>): void {
  pendingFinalizes.add(promise)
  void promise.finally(() => pendingFinalizes.delete(promise))
}

/** 等待所有进行中的终态落盘完成(供测试与停机使用)。 */
export async function waitCaptureFlush(): Promise<void> {
  await Promise.allSettled([...pendingFinalizes])
}
