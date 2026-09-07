import { deviceStore } from '../store/devices.js'
import { deviceJobStore, type DeviceJobRow } from '../store/device-jobs.js'
import { createChildLogger } from '../core/logger.js'
import type { ToolContext } from '../tools/types.js'
import type { DeviceConnections } from './connections.js'
import { DeviceJobLogs } from './job-logs.js'
import { isTerminalDeviceJob, validateJobResult, type DeviceJobRequest, type DeviceJobState } from './protocol.js'

const log = createChildLogger('devices:jobs')
const ACTIVE: DeviceJobState[] = ['queued', 'running', 'cancel_requested', 'unknown']

export class DeviceJobService {
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly timer: NodeJS.Timeout
  readonly logs: DeviceJobLogs

  constructor(readonly connections: Pick<DeviceConnections, 'send' | 'online'>, directory: string) {
    this.logs = new DeviceJobLogs(directory)
    for (const row of deviceJobStore.active()) deviceJobStore.transition(row.id, ACTIVE, 'unknown')
    this.timer = setInterval(() => this.checkTimeouts(), 1000)
    this.timer.unref()
  }

  async submit(deviceId: string, request: DeviceJobRequest, context: ToolContext, background: boolean): Promise<Record<string, unknown>> {
    const job = this.create(deviceId, request, context)
    return this.dispatch(job, request, background)
  }

  create(deviceId: string, request: DeviceJobRequest, context: ToolContext): DeviceJobRow {
    if (!context.sessionId || !context.agentId) throw new Error('远程执行需要当前会话和 Agent 上下文')
    const device = deviceStore.get(deviceId)
    if (!device?.enabled || device.revoked_at || !this.connections.online(deviceId)) throw new Error('目标设备离线或已停用，不会改用其他设备')
    if (request.type === 'shell' && !JSON.parse(device.shells_json).includes(request.shell)) throw new Error('设备不支持指定 Shell')
    const active = deviceJobStore.active(deviceId).filter((row) => row.state !== 'unknown' && (row.type === 'shell') === (request.type === 'shell'))
    if (active.length >= (request.type === 'shell' ? 2 : 1)) throw new Error('目标设备忙，请先查询现有作业')
    return deviceJobStore.create({ deviceId, sessionId: context.sessionId, agentId: context.agentId, projectId: context.projectId, request })
  }

  async dispatch(job: DeviceJobRow, request: DeviceJobRequest, background: boolean): Promise<Record<string, unknown>> {
    try { this.connections.send(job.device_id, { type: 'job.submit', jobId: job.id, deadlineAt: job.deadline_at, request }) }
    catch (err) {
      deviceJobStore.transition(job.id, ['queued'], 'unknown', { error: '发送时连接中断，执行状态未知，禁止自动重跑' })
      log.warn({ err, jobId: job.id, deviceId: job.device_id }, '发送设备作业失败')
    }
    log.info({ jobId: job.id, deviceId: job.device_id, sessionId: job.session_id, type: job.type }, '设备作业已提交')
    await this.wait(job.id, background)
    return this.describe(deviceJobStore.get(job.id) ?? job)
  }

  status(deviceId: string, jobId: string, context: ToolContext, cursor = 0): Record<string, unknown> {
    return this.describe(this.requireJob(deviceId, jobId, context), cursor)
  }

  cancel(deviceId: string, jobId: string, context: ToolContext): Record<string, unknown> {
    const job = this.requireJob(deviceId, jobId, context)
    if (isTerminalDeviceJob(job.state)) return this.describe(job)
    if (!this.connections.online(deviceId)) throw new Error('设备离线，无法确认取消；不会切换设备或声称已停止')
    deviceJobStore.transition(job.id, ACTIVE, 'cancel_requested')
    this.connections.send(deviceId, { type: 'job.cancel', jobId })
    return this.describe(deviceJobStore.get(jobId) ?? job)
  }

  connected(deviceId: string): void {
    for (const job of deviceJobStore.active(deviceId)) this.connections.send(deviceId, { type: 'job.query', jobId: job.id, cursor: this.logs.size(job.id) })
  }

  disconnected(deviceId: string): void {
    for (const job of deviceJobStore.active(deviceId)) {
      deviceJobStore.transition(job.id, ACTIVE, 'unknown', {
        ...(job.result_json ? JSON.parse(job.result_json) as Record<string, unknown> : {}),
        error: '设备连接中断，执行状态待核实，不自动重跑',
      })
      this.notify(job.id)
    }
  }

  message(deviceId: string, frame: Record<string, unknown>): void {
    if (typeof frame.jobId !== 'string') throw new Error('缺少作业 ID')
    const job = deviceJobStore.get(frame.jobId)
    if (!job || job.device_id !== deviceId) throw new Error('作业不属于此设备')
    if (frame.type === 'job.log') {
      if (typeof frame.text !== 'string' || typeof frame.offset !== 'number') throw new Error('日志帧无效')
      this.logs.append(job.id, frame.offset, frame.text)
      return
    }
    if (frame.type !== 'job.state' || typeof frame.state !== 'string') throw new Error('未知作业消息')
    const allowed = ['running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'unknown']
    if (!allowed.includes(frame.state)) throw new Error('作业状态无效')
    const result = validateJobResult(frame.result ?? {})
    if (job.type === 'file.upload' && frame.state === 'succeeded' && !job.file_json) throw new Error('上传文件尚未通过服务器校验')
    if (job.state === 'cancel_requested' && frame.state === 'running') return
    deviceJobStore.transition(job.id, ACTIVE, frame.state as DeviceJobState, result)
    this.notify(job.id)
    log.debug({ deviceId, jobId: job.id, state: frame.state }, '设备作业状态更新')
  }

  close(): void {
    clearInterval(this.timer)
    for (const callbacks of this.listeners.values()) for (const callback of callbacks) callback()
    this.listeners.clear()
  }

  requireJob(deviceId: string, jobId: string, context: ToolContext): DeviceJobRow {
    const row = deviceJobStore.get(jobId)
    if (!row || row.device_id !== deviceId || row.session_id !== context.sessionId || row.project_id !== (context.projectId ?? null)) {
      throw new Error('作业不存在或不属于当前设备和会话')
    }
    return row
  }

  describe(row: DeviceJobRow, cursor = 0): Record<string, unknown> {
    const device = deviceStore.get(row.device_id)
    const result = row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {}
    return { jobId: row.id, deviceId: row.device_id, machineName: device?.name, platform: device?.platform,
      state: row.state, ...result, ...this.logs.read(row.id, cursor),
      ...(row.file_json && row.file_id ? { fileId: row.file_id, ...JSON.parse(row.file_json) as Record<string, unknown> } : {}) }
  }

  private wait(jobId: string, background: boolean): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => { clearTimeout(timer); callbacks.delete(check); if (!callbacks.size) this.listeners.delete(jobId); resolve() }
      const check = (): void => {
        const job = deviceJobStore.get(jobId)
        if (!job || isTerminalDeviceJob(job.state) || job.state === 'unknown' || (background && job.state !== 'queued')) finish()
      }
      const callbacks = this.listeners.get(jobId) ?? new Set<() => void>()
      const timer = setTimeout(finish, 5000)
      callbacks.add(check)
      this.listeners.set(jobId, callbacks)
      check()
    })
  }

  private notify(jobId: string): void { for (const callback of this.listeners.get(jobId) ?? []) callback() }

  private checkTimeouts(): void {
    for (const job of deviceJobStore.active()) {
      if (job.deadline_at > Date.now() || job.state === 'cancel_requested' || job.state === 'unknown') continue
      if (this.connections.online(job.device_id)) {
        deviceJobStore.transition(job.id, ACTIVE, 'cancel_requested')
        this.connections.send(job.device_id, { type: 'job.cancel', jobId: job.id, reason: 'timeout' })
      } else deviceJobStore.transition(job.id, ACTIVE, 'unknown')
      this.notify(job.id)
    }
  }
}
