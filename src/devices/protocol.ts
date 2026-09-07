export const DEVICE_PROTOCOL_VERSION = 1
export const MAX_DEVICE_FRAME_BYTES = 256 * 1024
export const MAX_DEVICE_LOG_BYTES = 10 * 1024 * 1024
export type DeviceJobType = 'shell' | 'file.upload' | 'file.download'
export type DeviceJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'timed_out' | 'unknown'

export interface DeviceJobRequest {
  type: DeviceJobType
  command?: string
  cwd?: string
  shell?: 'powershell' | 'pwsh'
  outputEncoding?: 'utf8' | 'gb18030'
  timeoutSeconds: number
  localPath?: string
  overwrite?: boolean
  transfer?: { url: string; ticket: string; size?: number; sha256?: string; maxBytes: number }
}

export interface DeviceJobResult {
  exitCode?: number | null
  cwd?: string
  error?: string
  output?: string
  truncated?: boolean
  file?: { localPath?: string; size: number; sha256: string }
}

export function isTerminalDeviceJob(state: DeviceJobState): boolean {
  return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(state)
}

export function parseDeviceFrame(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw) > MAX_DEVICE_FRAME_BYTES) throw new Error('设备消息过大')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设备消息格式无效')
  const frame = value as Record<string, unknown>
  if (frame.version !== DEVICE_PROTOCOL_VERSION || typeof frame.type !== 'string') throw new Error('设备协议版本不兼容')
  return frame
}

export function validateJobResult(value: unknown): DeviceJobResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('作业结果无效')
  const row = value as Record<string, unknown>
  if (row.cwd !== undefined && (typeof row.cwd !== 'string' || row.cwd.length > 8192)) throw new Error('工作目录无效')
  if (row.error !== undefined && (typeof row.error !== 'string' || row.error.length > 8192)) throw new Error('错误结果无效')
  if (row.exitCode !== undefined && row.exitCode !== null && !Number.isSafeInteger(row.exitCode)) throw new Error('退出码无效')
  return {
    ...(row.cwd !== undefined ? { cwd: row.cwd as string } : {}),
    ...(row.error !== undefined ? { error: row.error as string } : {}),
    ...(row.exitCode !== undefined ? { exitCode: row.exitCode as number | null } : {}),
    ...(row.truncated === true ? { truncated: true } : {}),
  }
}
