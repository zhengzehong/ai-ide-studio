import { existsSync, mkdirSync } from 'node:fs'
import { readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
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
      await rename(tmpPath, finalPath)
      log.debug({ ...record.platform, terminalStatus, truncated: record.truncated }, 'Capture finalized')
      await enforceSessionFileLimit(dir, maxPerSession)
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

/** 进程重启后扫描未完成 .tmp,补 proxy_restart 终态(保留已收内容)。
 *  只扫最近 2 天(P0-4):`.tmp` 只可能来自"进程正在写时被杀",必然是最近一次运行;
 *  停机超过 2 天的老 .tmp 不再自动补终态,保留原样供人工检查。 */
export const RECOVER_RECENT_DAYS = 2

export async function recoverPendingCaptures(root: string, recentDays = RECOVER_RECENT_DAYS): Promise<number> {
  if (!existsSync(root)) return 0
  let recovered = 0
  for (const day of recentDayNames(await listDirNames(root), recentDays)) {
    for (const session of await listDirNames(join(root, day))) {
      const dir = join(root, day, session)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.json.tmp')) continue
        const tmpPath = join(dir, name)
        try {
          const parsed = JSON.parse(await readFile(tmpPath, 'utf8')) as CaptureRecord
          parsed.terminalStatus = 'proxy_restart'
          parsed.finishedAt = parsed.finishedAt ?? new Date().toISOString()
          const finalPath = tmpPath.replace(/\.tmp$/, '')
          await writeFile(tmpPath, JSON.stringify(parsed), 'utf8')
          await rename(tmpPath, finalPath)
          recovered += 1
        } catch (err) {
          log.warn({ err, tmpPath }, '抓包 tmp 恢复失败,保留 .tmp 供人工检查')
        }
      }
    }
  }
  if (recovered > 0) log.info({ recovered, recentDays }, '已补齐重启前的抓包文件')
  return recovered
}

export interface CaptureCleanupOptions {
  /** 总量上限(env CAPTURE_MAX_TOTAL_BYTES);未配置即只按保留期清理。 */
  maxTotalBytes?: number
  /** 单轮时间预算:超出则把剩余留到下一轮(默认 3s)。 */
  timeBudgetMs?: number
  /** 每片删除的文件数(默认 200),片间让出事件循环。 */
  filesPerSlice?: number
}

/** 上一轮没删完的目录,下一轮优先续跑(内存态,重启后重新 walk 即可,幂等)。 */
let pendingCleanupDay: string | null = null

/** 供测试清理跨轮次状态。 */
export function resetCaptureCleanupProgress(): void {
  pendingCleanupDay = null
}

/** 是否还有上一轮没删完的目录(调用方据此决定是否提前重试)。 */
export function captureCleanupPending(): boolean {
  return pendingCleanupDay !== null
}

/**
 * 按保留天数清理:整天目录删除。
 * P0-4:改分片异步 —— 每 filesPerSlice(200)个文件删一批,批间 setImmediate 让出主线程,
 * 单轮超过 timeBudgetMs(3s)就带着 remaining 状态返回,下一轮继续,避免整目录 rmSync
 * 把事件循环按住(实测 2.7GB/6,422 文件同步删会阻塞主线程 915ms,事故磁盘上换算 ~40s)。
 * 返回本轮**完整删除**的天目录数。
 */
export async function cleanupExpiredCaptures(
  root: string,
  retentionDays: number,
  options: CaptureCleanupOptions = {},
): Promise<number> {
  if (!existsSync(root)) return 0
  const { maxTotalBytes, timeBudgetMs = CLEANUP_TIME_BUDGET_MS, filesPerSlice = CLEANUP_FILES_PER_SLICE } = options
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const deadline = Date.now() + timeBudgetMs
  const expired = (await listDirNames(root)).filter((day) => {
    const dayMs = Date.parse(`${day}T00:00:00Z`)
    return !Number.isNaN(dayMs) && dayMs < cutoff
  })
  // 续跑优先:上一轮没删完的目录排到最前
  expired.sort((left, right) => {
    if (left === pendingCleanupDay) return -1
    if (right === pendingCleanupDay) return 1
    return left.localeCompare(right)
  })

  let removedDays = 0
  for (const day of expired) {
    const result = await removeTreeChunked(join(root, day), deadline, filesPerSlice)
    if (!result.done) {
      pendingCleanupDay = day
      log.info(
        { day, removedFiles: result.removedFiles, timeBudgetMs },
        '抓包目录清理超出单轮时间预算,剩余留待下一轮',
      )
      return removedDays
    }
    removedDays += 1
    if (pendingCleanupDay === day) pendingCleanupDay = null
    log.info({ day, removedFiles: result.removedFiles, retentionDays }, '已清理过期抓包目录')
  }

  if (maxTotalBytes !== undefined && maxTotalBytes > 0) {
    removedDays += await enforceCaptureTotalBytes(root, maxTotalBytes, { timeBudgetMs, filesPerSlice })
  }
  return removedDays
}

/** CAPTURE_MAX_TOTAL_BYTES:未配置/非法/<=0 一律视为关闭(默认关闭,开启才会多删数据)。 */
export function parseCaptureMaxTotalBytes(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

/** 总量上限:超过 maxTotalBytes 时从最老的一天开始分片删(默认关闭,见 parseCaptureMaxTotalBytes)。 */
export async function enforceCaptureTotalBytes(
  root: string,
  maxTotalBytes: number,
  options: Pick<CaptureCleanupOptions, 'timeBudgetMs' | 'filesPerSlice'> = {},
): Promise<number> {
  if (!existsSync(root) || maxTotalBytes <= 0) return 0
  const { timeBudgetMs = CLEANUP_TIME_BUDGET_MS, filesPerSlice = CLEANUP_FILES_PER_SLICE } = options
  const days = (await listDirNames(root)).sort()
  const sizes: Array<{ day: string; bytes: number }> = []
  for (const day of days) sizes.push({ day, bytes: await directoryBytes(join(root, day)) })
  let total = sizes.reduce((sum, item) => sum + item.bytes, 0)
  if (total <= maxTotalBytes) return 0

  const deadline = Date.now() + timeBudgetMs
  let removedDays = 0
  for (const { day, bytes } of sizes) {
    if (total <= maxTotalBytes) break
    const result = await removeTreeChunked(join(root, day), deadline, filesPerSlice)
    if (!result.done) {
      log.info({ day, maxTotalBytes, timeBudgetMs }, '抓包总量清理超出单轮时间预算,剩余留待下一轮')
      break
    }
    total -= bytes
    removedDays += 1
    log.info({ day, removedBytes: bytes, totalBytes: total, maxTotalBytes }, '抓包总量超限,已清理最老一天')
  }
  return removedDays
}

/**
 * 每会话目录保留最新 maxPerSession 个「计数类」已落盘 .json(文件名 HHmmss-seq 字典序=时间序,删最老)。
 * 计数口径:仅正式请求 messages/responses 占额度;count_tokens/探测照常落盘但不占额度、绝不被清理。
 * 红线:.json.tmp 正在写入,不计入数量、绝不清理。失败只 warn 不抛出。
 * P0-4:readdir/unlink 全部改异步(此前是 finalize 热路径上的同步 I/O);
 * 按裁决不加内存计数缓存 —— 会话目录 <=100 文件,一次 readdir ~0.1-1ms,不值得引入缓存不一致风险。
 */
export async function enforceSessionFileLimit(sessionDirPath: string, maxPerSession: number): Promise<number> {
  if (maxPerSession < 1 || !existsSync(sessionDirPath)) return 0
  let names: string[]
  try {
    names = await readdir(sessionDirPath)
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
      await unlink(join(sessionDirPath, name))
      removed += 1
    } catch (err) {
      log.warn({ err, dir: sessionDirPath, name }, '会话抓包超限清理失败')
    }
  }
  if (removed > 0) log.info({ removed, dir: sessionDirPath, maxPerSession }, '会话抓包超限,已清理最老文件')
  return removed
}

const CLEANUP_FILES_PER_SLICE = 200
const CLEANUP_TIME_BUDGET_MS = 3_000

/** 分片删除一棵子树:每 filesPerSlice 个文件一批,批间让出事件循环;超出 deadline 返回 done:false。 */
async function removeTreeChunked(
  dirPath: string,
  deadline: number,
  filesPerSlice: number,
): Promise<{ done: boolean; removedFiles: number }> {
  const stack: string[] = [dirPath]
  const visitedDirs: string[] = []
  let batch: string[] = []
  let removedFiles = 0

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const current = batch
    batch = []
    await Promise.all(current.map((file) => unlink(file).catch(() => undefined)))
    removedFiles += current.length
    await yieldToEventLoop()
  }

  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    visitedDirs.push(current)
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else batch.push(full)
      if (batch.length >= filesPerSlice) {
        await flush()
        if (Date.now() > deadline) return { done: false, removedFiles }
      }
    }
  }
  await flush()
  // 文件删完后自底向上回收空目录(深度优先:路径长的先删);失败多半是仍有残留,留待下一轮
  for (const dir of visitedDirs.sort((left, right) => right.length - left.length)) {
    await rmdir(dir).catch(() => undefined)
  }
  return { done: true, removedFiles }
}

/** 目录子树字节数(仅在总量上限开启时调用)。 */
async function directoryBytes(dirPath: string): Promise<number> {
  let total = 0
  const stack = [dirPath]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          total += (await stat(full)).size
        } catch {
          // 已消失的文件不计入
        }
      }
    }
  }
  return total
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function recentDayNames(days: string[], recentDays: number): string[] {
  const cutoffDay = new Date(Date.now() - (recentDays - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return days.filter((day) => day >= cutoffDay).sort()
}

async function listDirNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
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

function trackFinalize(promise: Promise<void>): void {
  pendingFinalizes.add(promise)
  void promise.finally(() => pendingFinalizes.delete(promise))
}

/** 等待所有进行中的终态落盘完成(供测试与停机使用)。 */
export async function waitCaptureFlush(): Promise<void> {
  await Promise.allSettled([...pendingFinalizes])
}
