import { settingsStore } from '../store/settings.js'
import { createChildLogger } from '../core/logger.js'

export type AgentModelProfileMode = 'global' | 'fixed' | 'system'
export type GlobalModelProfileRuntime = 'claude' | 'codex'

export interface GlobalModelProfileState {
  enabled: boolean
  profileId?: string
}

const SETTING_PREFIX = 'runtime.globalModelProfile.'
const log = createChildLogger('runtime-global-model-profile')

export function getGlobalModelProfile(runtime: GlobalModelProfileRuntime): GlobalModelProfileState {
  const raw = settingsStore.get(`${SETTING_PREFIX}${runtime}`)
  if (!raw) return { enabled: false }
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown; profileId?: unknown }
    return {
      enabled: parsed.enabled === true,
      ...(typeof parsed.profileId === 'string' && parsed.profileId.trim() ? { profileId: parsed.profileId.trim() } : {}),
    }
  } catch {
    return { enabled: false }
  }
}

export function setGlobalModelProfile(runtime: GlobalModelProfileRuntime, profileId: string): void {
  const normalizedProfileId = profileId.trim()
  if (!normalizedProfileId) throw new Error('全局模型档案不能为空')
  settingsStore.set(`${SETTING_PREFIX}${runtime}`, JSON.stringify({ enabled: true, profileId: normalizedProfileId }))
  log.info({ runtime, profileId: normalizedProfileId }, 'Runtime 全局模型档案已更新')
}

export function clearGlobalModelProfile(runtime: GlobalModelProfileRuntime): void {
  settingsStore.delete(`${SETTING_PREFIX}${runtime}`)
  log.info({ runtime }, 'Runtime 全局模型档案已清除')
}

export function readModelProfileId(configJson: string | null): string | undefined {
  const config = parseConfig(configJson)
  return typeof config.modelProfileId === 'string' && config.modelProfileId.trim()
    ? config.modelProfileId.trim()
    : undefined
}

export function readAgentModelProfileMode(configJson: string | null): AgentModelProfileMode {
  const config = parseConfig(configJson)
  if (config.modelProfileMode === 'global' || config.modelProfileMode === 'fixed' || config.modelProfileMode === 'system') {
    return config.modelProfileMode
  }
  return readModelProfileId(configJson) ? 'fixed' : 'global'
}

export function parseAgentConfig(configJson: string | null): Record<string, unknown> {
  return parseConfig(configJson)
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}
