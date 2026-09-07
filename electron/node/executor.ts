import { JobJournal } from './job-journal.js'
import { executeNodeShell } from './shell-executor.js'
import { runNodeFileTransfer } from './file-transfer.js'
import { createChildLogger } from './logger.js'
import { isTerminal, type JournalEntry, type JobState, type NodeRequest, type NodeResult, type SendFrame } from './types.js'

const log = createChildLogger('executor')
interface ActiveJob { type: string; cancel(reason?: 'timeout'): Promise<void>; completion: Promise<void> }

export class NodeExecutor {
  private readonly active = new Map<string, ActiveJob>()
  private readonly journal: JobJournal
  private stopping = false

  constructor(directory: string, private readonly shells: Partial<Record<'powershell' | 'pwsh', string>>,
    private readonly origin: string, private readonly token: string, private readonly send: SendFrame) {
    this.journal = new JobJournal(directory)
  }

  receive(frame: Record<string, unknown>): void {
    if (typeof frame.jobId !== 'string') throw new Error('缺少作业 ID')
    const id = frame.jobId
    if (frame.type === 'job.query') { this.query(id, typeof frame.cursor === 'number' ? frame.cursor : 0); return }
    if (frame.type === 'job.cancel') {
      const active = this.active.get(id)
      if (active) void active.cancel(frame.reason === 'timeout' ? 'timeout' : undefined)
        .catch((err: unknown) => log.error({ err, jobId: id }, '停止设备作业失败'))
      else this.query(id)
      return
    }
    if (frame.type !== 'job.submit') throw new Error('未知设备命令')
    const existing = this.journal.get(id)
    if (existing) { this.query(id); return }
    if (this.stopping) throw new Error('执行节点正在停止')
    const request = validateRequest(frame.request)
    const deadline = frame.deadlineAt
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) throw new Error('作业截止时间无效')
    const entry: JournalEntry = { id, state: 'queued', result: {}, deadlineAt: deadline, updatedAt: Date.now() }
    this.journal.save(entry)
    const slots = [...this.active.values()].filter((job) => (job.type === 'shell') === (request.type === 'shell')).length
    if (slots >= (request.type === 'shell' ? 2 : 1)) { this.finish(id, 'failed', { error: '设备忙' }); return }
    if (deadline <= Date.now()) { this.finish(id, 'timed_out', { error: '作业在启动前已过期' }); return }
    request.timeoutSeconds = Math.min(request.timeoutSeconds, Math.max(1, Math.ceil((deadline - Date.now()) / 1000)))
    // Durable receipt must precede spawning. Restarted nonterminal receipts are never replayed.
    this.journal.save({ ...entry, state: 'running' })
    try {
      if (request.type === 'shell') {
        const executable = request.shell ? this.shells[request.shell] : undefined
        if (!executable) throw new Error('指定 Shell 未安装')
        let truncated = false
        const run = executeNodeShell({ request, executable,
          output: (text) => {
            try { truncated = this.journal.append(id, text, this.send) || truncated }
            catch (err) { log.error({ err, jobId: id }, '设备作业日志落盘失败'); void this.active.get(id)?.cancel() }
          },
          finish: (state, result) => this.finish(id, state, { ...result, truncated }),
        })
        this.active.set(id, { type: request.type, ...run })
        this.journal.save({ ...entry, state: 'running', result: { cwd: run.cwd } })
        this.send({ type: 'job.state', jobId: id, state: 'running', result: { cwd: run.cwd } })
      } else {
        this.send({ type: 'job.state', jobId: id, state: 'running', result: {} })
        const abort = new AbortController()
        let cancelled: 'cancelled' | 'timed_out' | undefined
        const timer = setTimeout(() => { cancelled = 'timed_out'; abort.abort() }, request.timeoutSeconds * 1000)
        const completion = runNodeFileTransfer(request, this.origin, this.token, abort.signal)
          .then(() => this.finish(id, 'succeeded', {}))
          .catch((err: unknown) => this.finish(id, cancelled ?? 'failed', { error: err instanceof Error ? err.message : '文件传输失败' }))
          .finally(() => clearTimeout(timer))
        this.active.set(id, { type: request.type, completion,
          cancel: async (reason) => { cancelled = reason === 'timeout' ? 'timed_out' : 'cancelled'; abort.abort(); await completion },
        })
      }
    } catch (err) {
      log.warn({ err, jobId: id }, '设备作业启动失败')
      this.finish(id, 'failed', { error: err instanceof Error ? err.message : '作业启动失败' })
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    await Promise.all([...this.active.values()].map((job) => job.cancel()))
  }

  private query(id: string, cursor = 0): void {
    let entry = this.journal.get(id)
    if (!entry) {
      // A cancel/query tombstone also prevents a delayed submit from starting a cancelled job.
      entry = { id, state: 'unknown', result: { error: '客户端没有可确认的执行记录，禁止自动重跑' }, deadlineAt: 0, updatedAt: Date.now() }
      this.journal.save(entry)
    } else if (!isTerminal(entry.state) && !this.active.has(id)) {
      entry = { ...entry, state: 'unknown', result: { ...entry.result, error: '执行节点已重启，作业结果未知，不重新执行' } }
      this.journal.save(entry)
    }
    this.journal.replay(id, this.send, cursor)
    this.send({ type: 'job.state', jobId: id, state: entry.state, result: entry.result })
  }

  private finish(id: string, state: JobState, result: NodeResult): void {
    // A failed tree kill may leave processes alive; keep their execution slot reserved.
    if (state !== 'unknown') this.active.delete(id)
    try {
      const existing = this.journal.get(id)
      if (!existing) return
      this.journal.save({ ...existing, state, result, updatedAt: Date.now() })
    } catch (err) {
      log.error({ err, jobId: id }, '设备作业结果落盘失败')
      state = 'unknown'
      result = { error: '本地作业结果无法落盘，禁止自动重跑' }
    }
    this.send({ type: 'job.state', jobId: id, state, result })
    log.info({ jobId: id, state, exitCode: result.exitCode }, '设备作业结束')
  }
}

function validateRequest(value: unknown): NodeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设备作业参数无效')
  const request = value as NodeRequest
  if (!['shell', 'file.upload', 'file.download'].includes(request.type)) throw new Error('作业类型无效')
  const maxTimeout = request.type === 'shell' ? 600 : 1800
  if (request.outputEncoding !== undefined && request.outputEncoding !== 'utf8' && request.outputEncoding !== 'gb18030') throw new Error('控制台编码无效')
  if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > maxTimeout) throw new Error('作业超时无效')
  return { ...request }
}
