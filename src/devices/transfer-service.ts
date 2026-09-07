import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { Hono } from 'hono'
import { createChildLogger } from '../core/logger.js'
import { deviceJobStore, type DeviceFile, type DeviceJobRow } from '../store/device-jobs.js'
import { projectStore } from '../store/projects.js'
import type { ToolContext } from '../tools/types.js'
import { authenticateDevice, hashDeviceSecret } from './auth.js'
import { isTerminalDeviceJob, type DeviceJobRequest } from './protocol.js'
import { requiredText } from './tool-service.js'
import { resolveDeviceServerSource, snapshotDeviceFile, storeDeviceStream } from './file-stream.js'
import type { DeviceJobService } from './job-service.js'

const log = createChildLogger('devices:transfers')
const RETENTION_MS = 7 * 24 * 60 * 60_000
interface Transfer {
  job: DeviceJobRow; request: DeviceJobRequest; directory: string; file: string; ticketHash: string
  started: boolean; expiresAt: number; reserved: number; abort: AbortController
  metadata?: { size: number; sha256: string }
}

export class DeviceTransferService {
  private readonly transfers = new Map<string, Transfer>()
  private readonly timer: NodeJS.Timeout
  private cleaning = false
  private closed = false
  readonly maxFileBytes: number
  private readonly quota: number

  constructor(private readonly jobs: DeviceJobService, private readonly directory: string,
    limits: { maxFileBytes?: number; quotaBytes?: number } = {}) {
    this.maxFileBytes = limits.maxFileBytes ?? positiveEnv('DEVICE_FILE_MAX_BYTES', 1024 ** 3)
    this.quota = limits.quotaBytes ?? positiveEnv('DEVICE_FILE_QUOTA_BYTES', 5 * 1024 ** 3)
    this.recoverInterruptedTransfers()
    this.timer = setInterval(() => { void this.cleanup() }, 15_000)
    this.timer.unref()
  }

  async submit(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const deviceId = requiredText(input.deviceId, 'deviceId')
    const type = input.type
    if (type !== 'file.upload' && type !== 'file.download') throw new Error('文件操作类型无效')
    const localPath = requiredText(input.localPath, 'localPath', 8192)
    if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(localPath)) throw new Error('localPath 必须是 PC 绝对文件路径')
    if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw new Error('overwrite 必须是布尔值')
    if (type === 'file.download' && Boolean(input.serverPath) === Boolean(input.fileId)) throw new Error('serverPath 和 fileId 必须二选一')
    if (!context.projectId) throw new Error('文件传输需要当前项目上下文')
    const used = deviceJobStore.files().reduce((sum, row) => sum + (JSON.parse(row.file_json!) as DeviceFile).size, 0)
    const reserved = [...this.transfers.values()].reduce((sum, item) => sum + item.reserved, 0)
    if (used + reserved + this.maxFileBytes > this.quota) throw new Error('设备文件临时空间配额不足，请清理过期文件后重试')
    const request: DeviceJobRequest = { type, localPath, overwrite: input.overwrite === true, timeoutSeconds: 1800 }
    const job = this.jobs.create(deviceId, request, context)
    const directory = join(this.directory, job.id)
    const ticket = randomBytes(32).toString('base64url')
    const transfer: Transfer = { job, request, directory, file: join(directory, 'content'), ticketHash: hashDeviceSecret(ticket),
      started: false, expiresAt: Date.now() + 5 * 60_000, reserved: this.maxFileBytes, abort: new AbortController() }
    this.transfers.set(job.id, transfer)
    void this.prepare(transfer, input, context, ticket).catch((err: unknown) => this.fail(transfer, err))
    return this.jobs.describe(job)
  }

  mount(app: Hono): void {
    app.all('/node/files/:jobId', async (c) => {
      const device = authenticateDevice(c.req.header('authorization'))
      const transfer = this.transfers.get(c.req.param('jobId'))
      const ticket = c.req.header('x-device-ticket')
      if (!device || !transfer || transfer.job.device_id !== device.id || !ticket || hashDeviceSecret(ticket) !== transfer.ticketHash) {
        return c.json({ error: '传输未授权' }, 401)
      }
      const job = deviceJobStore.get(transfer.job.id)
      if (!job || isTerminalDeviceJob(job.state) || job.state === 'cancel_requested' || transfer.started || transfer.expiresAt < Date.now()) {
        return c.json({ error: '传输已开始、已结束或票据过期，请重新提交作业' }, 409)
      }
      const upload = transfer.request.type === 'file.upload'
      if (c.req.method !== (upload ? 'PUT' : 'GET')) return c.json({ error: '传输方向错误' }, 405)
      transfer.started = true
      try {
        if (upload) {
          const size = Number(c.req.header('content-length'))
          if (!Number.isSafeInteger(size) || size < 0 || size > this.maxFileBytes || !c.req.raw.body) throw new Error('文件大小无效')
          const expectedHash = c.req.header('x-file-sha256') ?? ''
          if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('文件 SHA256 缺失')
          const temporary = join(transfer.directory, 'uploading')
          const source = Readable.fromWeb(c.req.raw.body as import('node:stream/web').ReadableStream<Uint8Array>)
          const metadata = await storeDeviceStream(source, temporary, this.maxFileBytes, transfer.abort.signal)
          if (metadata.size !== size || metadata.sha256 !== expectedHash) throw new Error('文件大小或 SHA256 校验失败')
          await rename(temporary, transfer.file)
          transfer.abort.signal.throwIfAborted()
          if (this.closed) throw new Error('服务正在停止')
          const file: DeviceFile = { ...metadata, serverPath: transfer.file, expiresAt: Date.now() + RETENTION_MS }
          const fileId = deviceJobStore.setFile(job.id, file)
          transfer.reserved = 0
          log.info({ jobId: job.id, deviceId: device.id, size: file.size }, '设备上传文件已校验')
          return c.json({ fileId, ...file })
        }
        if (!transfer.metadata) throw new Error('下载文件尚未就绪')
        const source = createReadStream(transfer.file, { signal: transfer.abort.signal })
        let idle: NodeJS.Timeout
        const reset = (): void => { clearTimeout(idle); idle = setTimeout(() => source.destroy(new Error('下载 60 秒无进展')), 60_000) }
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback): void { reset(); callback(null, chunk) } })
        reset()
        source.once('close', () => clearTimeout(idle))
        source.once('error', (err) => { meter.destroy(err); log.warn({ err, jobId: job.id }, '设备下载流失败') })
        meter.once('close', () => source.destroy())
        return new Response(Readable.toWeb(source.pipe(meter)) as ReadableStream<Uint8Array>, { headers: {
          'Content-Type': 'application/octet-stream', 'Content-Length': String(transfer.metadata.size),
          'x-file-sha256': transfer.metadata.sha256, 'Cache-Control': 'no-store',
        } })
      } catch (err) {
        await this.fail(transfer, err)
        return c.json({ error: '文件传输失败，请查询作业结果' }, 400)
      }
    })
  }

  close(): void {
    this.closed = true
    clearInterval(this.timer)
    for (const transfer of this.transfers.values()) transfer.abort.abort()
  }

  private recoverInterruptedTransfers(): void {
    for (const job of deviceJobStore.active()) {
      if (job.type === 'shell') continue
      deviceJobStore.transition(job.id, ['queued', 'running', 'cancel_requested', 'unknown'],
        job.type === 'file.upload' && !!job.file_json ? 'succeeded' : 'failed',
        job.file_json ? {} : { error: '服务器已重启，文件传输不续传；请重新提交' })
    }
    if (!existsSync(this.directory)) return
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^djob-[0-9a-f-]{36}$/.test(entry.name) || deviceJobStore.get(entry.name)?.file_json) continue
      void rm(join(this.directory, entry.name), { recursive: true, force: true }).catch((err: unknown) => {
        log.warn({ err, jobId: entry.name }, '清理重启前传输快照失败')
      })
    }
  }

  private async prepare(transfer: Transfer, input: Record<string, unknown>, context: ToolContext, ticket: string): Promise<void> {
    await mkdir(transfer.directory, { recursive: true })
    if (transfer.request.type === 'file.download') {
      let source: string
      if (input.fileId) {
        const original = deviceJobStore.findFile(requiredText(input.fileId, 'fileId'))
        if (!original || original.session_id !== context.sessionId || original.project_id !== context.projectId || !original.file_json) throw new Error('文件不属于当前会话')
        const file = JSON.parse(original.file_json) as DeviceFile
        if (file.expiresAt <= Date.now()) throw new Error('源文件已过期')
        source = file.serverPath
      } else {
        const project = projectStore.get(context.projectId!)
        if (!project) throw new Error('项目不存在')
        source = await resolveDeviceServerSource(project.work_dir, requiredText(input.serverPath, 'serverPath', 8192))
      }
      transfer.metadata = await snapshotDeviceFile(source, transfer.file, this.maxFileBytes, transfer.abort.signal)
      transfer.reserved = transfer.metadata.size
    }
    if (this.closed || deviceJobStore.get(transfer.job.id)?.state !== 'queued') throw new Error('文件作业准备期间已停止或断线')
    transfer.expiresAt = Date.now() + 5 * 60_000
    await this.jobs.dispatch(transfer.job, { ...transfer.request, transfer: {
      url: `/node/files/${transfer.job.id}`, ticket, maxBytes: this.maxFileBytes, ...transfer.metadata,
    } }, true)
  }

  private async fail(transfer: Transfer, error: unknown): Promise<void> {
    log.warn({ err: error, jobId: transfer.job.id, deviceId: transfer.job.device_id }, '设备文件作业失败')
    if (!this.closed) deviceJobStore.transition(transfer.job.id, ['queued', 'running', 'unknown', 'cancel_requested'], 'failed', {
      error: error instanceof Error ? error.message : '文件传输失败',
    })
    transfer.abort.abort()
    try {
      if (this.closed || !deviceJobStore.get(transfer.job.id)?.file_json) {
        await rm(transfer.directory, { recursive: true, force: true })
      }
      this.transfers.delete(transfer.job.id)
    } catch (err) { log.warn({ err, jobId: transfer.job.id }, '清理传输临时文件失败，保留记录等待重试') }
  }

  private async cleanup(): Promise<void> {
    if (this.cleaning || this.closed) return
    this.cleaning = true
    try {
      for (const transfer of this.transfers.values()) {
        const job = deviceJobStore.get(transfer.job.id)
        if (!job || isTerminalDeviceJob(job.state) || job.state === 'cancel_requested' || job.deadline_at < Date.now()) {
          transfer.abort.abort()
          if (!job?.file_json) await rm(transfer.directory, { recursive: true, force: true })
          this.transfers.delete(transfer.job.id)
        }
      }
      for (const job of deviceJobStore.files()) {
        if ((JSON.parse(job.file_json!) as DeviceFile).expiresAt > Date.now()) continue
        await rm(join(this.directory, job.id), { recursive: true, force: true })
        deviceJobStore.clearFile(job.id)
      }
    } catch (err) { log.warn({ err }, '设备文件过期清理失败') }
    finally { this.cleaning = false }
  }
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
