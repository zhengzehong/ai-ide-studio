import { settingsStore } from '../store/settings.js'

/** 模型代理抓包总开关与代理端口的集中配置(遵循 settings 表 kv+JSON 模式)。 */

export const MODEL_CAPTURE_SETTINGS_KEY = 'modelCapture.config'
export const MODEL_CAPTURE_PROXY_PORT_ENV = 'MODEL_CAPTURE_PROXY_PORT'
export const DEFAULT_MODEL_CAPTURE_PROXY_PORT = 3090
export const DEFAULT_CAPTURE_RETENTION_DAYS = 7
export const DEFAULT_CAPTURE_MAX_PER_SESSION = 100

export interface CaptureSettings {
  enabled: boolean
  retentionDays: number
  /** 每会话目录最多保留的已落盘 .json 文件数(HTTP 请求粒度),超出删最老。 */
  maxPerSession: number
}

interface CaptureSettingsRaw {
  enabled?: unknown
  retentionDays?: unknown
  maxPerSession?: unknown
}

export function getCaptureSettings(): CaptureSettings {
  const raw = settingsStore.get(MODEL_CAPTURE_SETTINGS_KEY)
  if (!raw) {
    return { enabled: false, retentionDays: DEFAULT_CAPTURE_RETENTION_DAYS, maxPerSession: DEFAULT_CAPTURE_MAX_PER_SESSION }
  }
  try {
    const parsed = JSON.parse(raw) as CaptureSettingsRaw
    return {
      enabled: parsed.enabled === true,
      retentionDays: normalizeRetentionDays(parsed.retentionDays),
      maxPerSession: normalizeMaxPerSession(parsed.maxPerSession),
    }
  } catch {
    return { enabled: false, retentionDays: DEFAULT_CAPTURE_RETENTION_DAYS, maxPerSession: DEFAULT_CAPTURE_MAX_PER_SESSION }
  }
}

export function setCaptureSettings(patch: { enabled?: boolean; retentionDays?: number; maxPerSession?: number }): CaptureSettings {
  const current = getCaptureSettings()
  const next: CaptureSettings = {
    enabled: patch.enabled ?? current.enabled,
    retentionDays: patch.retentionDays !== undefined
      ? normalizeRetentionDays(patch.retentionDays)
      : current.retentionDays,
    maxPerSession: patch.maxPerSession !== undefined
      ? normalizeMaxPerSession(patch.maxPerSession)
      : current.maxPerSession,
  }
  settingsStore.set(MODEL_CAPTURE_SETTINGS_KEY, JSON.stringify(next))
  return next
}

export function getCaptureProxyPort(): number {
  const parsed = Number.parseInt(process.env[MODEL_CAPTURE_PROXY_PORT_ENV] ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_MODEL_CAPTURE_PROXY_PORT
}

/** 开关开启时注入给 agent 的 BASE_URL(带 /agent-<agentId> 路由前缀)。 */
export function buildCaptureProxyBaseUrl(agentId: string): string {
  return `http://127.0.0.1:${getCaptureProxyPort()}/agent-${agentId}`
}

function normalizeRetentionDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 365
    ? parsed
    : DEFAULT_CAPTURE_RETENTION_DAYS
}

function normalizeMaxPerSession(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : DEFAULT_CAPTURE_MAX_PER_SESSION
}
