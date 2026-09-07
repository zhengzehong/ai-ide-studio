import { deviceStore } from '../store/devices.js'
import { sessionStore } from '../store/sessions.js'
import type { ToolContext } from '../tools/types.js'
import type { DeviceToolAction } from './tool-provider.js'
import type { DeviceJobService } from './job-service.js'
import type { DeviceConnections } from './connections.js'
import type { DeviceJobRequest } from './protocol.js'
import { assertDeviceToolOwner, getCurrentOriginDeviceId } from './prompt-origin.js'
import { DEVICE_INVOKE_SCHEMA } from './tool-contract.js'

export type TransferSubmitter = (input: Record<string, unknown>, context: ToolContext) => Promise<unknown>

export class DeviceToolService {
  constructor(private readonly connections: DeviceConnections, private readonly jobs: DeviceJobService,
    private readonly transfer: TransferSubmitter) {}

  list(currentDeviceId?: string): Record<string, unknown> {
    return { defaultExecution: 'server', devices: deviceStore.list().map((device) => ({
      deviceId: device.id, machineName: device.name, platform: device.platform, shells: JSON.parse(device.shells_json),
      osVersion: device.os_version, paths: JSON.parse(device.paths_json),
      defaultShell: (JSON.parse(device.shells_json) as string[]).includes('pwsh') ? 'pwsh' : 'powershell',
      enabled: device.enabled === 1, online: device.enabled === 1 && this.connections.online(device.id),
      isCurrentDevice: device.id === currentDeviceId, lastSeenAt: device.last_seen_at,
    })) }
  }

  async execute(action: DeviceToolAction, input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    assertDeviceToolOwner(context.sessionId)
    const session = context.sessionId ? sessionStore.get(context.sessionId) : undefined
    if (!session || session.agent_id !== context.agentId) throw new Error('工具会话身份不匹配')
    if (action === 'device_list') {
      if (Object.keys(input).length) throw new Error('device_list 无需参数，当前设备由平台识别')
      return this.list(getCurrentOriginDeviceId(context.sessionId))
    }
    for (const key of Object.keys(input)) if (!(key in DEVICE_INVOKE_SCHEMA.properties)) throw new Error(`未知参数: ${key}`)
    const deviceId = requiredText(input.deviceId, 'deviceId')
    const type = requiredText(input.type, 'type')
    const fields: Record<string, string[]> = {
      shell: ['command', 'cwd', 'shell', 'timeoutSeconds', 'background', 'outputEncoding'],
      'job.status': ['jobId', 'cursor'], 'job.cancel': ['jobId'],
      'file.upload': ['localPath'], 'file.download': ['localPath', 'serverPath', 'fileId', 'overwrite'],
    }
    const allowed = new Set(['deviceId', 'type', ...(fields[type] ?? [])])
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`${type} 不接受参数 ${key}`)
    if (type === 'job.status') return this.jobs.status(deviceId, requiredText(input.jobId, 'jobId'), context, integer(input.cursor, 0, 0, 10 * 1024 * 1024))
    if (type === 'job.cancel') return this.jobs.cancel(deviceId, requiredText(input.jobId, 'jobId'), context)
    if (type === 'file.upload' || type === 'file.download') return this.transfer(input, context)
    if (type !== 'shell') throw new Error('不支持的设备操作')
    const device = deviceStore.get(deviceId)
    const shells = device ? JSON.parse(device.shells_json) as string[] : []
    const shell = input.shell ?? (shells.includes('pwsh') ? 'pwsh' : 'powershell')
    if (shell !== 'pwsh' && shell !== 'powershell') throw new Error('不支持的 Shell')
    const outputEncoding = input.outputEncoding ?? 'utf8'
    if (outputEncoding !== 'utf8' && outputEncoding !== 'gb18030') throw new Error('不支持的控制台编码')
    const request: DeviceJobRequest = { type, shell, outputEncoding, command: requiredText(input.command, 'command', 24_000),
      timeoutSeconds: integer(input.timeoutSeconds, 60, 1, 600),
      ...(input.cwd !== undefined ? { cwd: requiredText(input.cwd, 'cwd', 8192) } : {}) }
    if (input.background !== undefined && typeof input.background !== 'boolean') throw new Error('background 必须是布尔值')
    return this.jobs.submit(deviceId, request, context, input.background === true)
  }
}

export function requiredText(value: unknown, name: string, limit = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${name} 必填且不能过长`)
  return value.trim()
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`数值必须在 ${min} 到 ${max} 范围内`)
  return value
}
