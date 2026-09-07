import { getStoredAccessToken } from '../stores/connection.store'

export interface DeviceSummary {
  deviceId: string
  machineName: string
  platform: string
  shells: string[]
  enabled: boolean
  online: boolean
  isCurrentDevice: boolean
  lastSeenAt: string | null
}

export async function listDevices(): Promise<DeviceSummary[]> {
  const response = await request('/api/v1/devices') as { devices: DeviceSummary[] }
  return response.devices
}

export async function updateDevice(deviceId: string, body: { enabled: boolean } | { action: 'revoke' }): Promise<void> {
  await request(`/api/v1/devices/${encodeURIComponent(deviceId)}`, body)
}

async function request(path: string, body?: object): Promise<unknown> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-ai-ide-token': getStoredAccessToken() },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) })
  const result = await response.json() as { error?: string }
  if (!response.ok) throw new Error(result.error ?? '设备请求失败')
  return result
}
