/** 模型档案相关的纯解析/过滤逻辑,供 sheet 与测试共用 */

export type ModelProfileMode = 'global' | 'fixed' | 'system'

export interface AgentProfileConfig {
  mode: ModelProfileMode
  profileId: string | null
}

/** 与 PC 端 AgentSettingsModal 同规则:显式 mode 优先;否则有 profileId 视为 fixed;再退回 global */
export function parseAgentProfile(configJson: string | null | undefined): AgentProfileConfig {
  if (!configJson) return { mode: 'global', profileId: null }
  try {
    const config = JSON.parse(configJson) as { modelProfileId?: unknown; modelProfileMode?: unknown }
    const profileId = typeof config.modelProfileId === 'string' && config.modelProfileId ? config.modelProfileId : null
    if (config.modelProfileMode === 'global' || config.modelProfileMode === 'fixed' || config.modelProfileMode === 'system') {
      return { mode: config.modelProfileMode, profileId }
    }
    if (profileId) return { mode: 'fixed', profileId }
    return { mode: 'global', profileId: null }
  } catch {
    return { mode: 'global', profileId: null }
  }
}

export interface ModelProfileLike {
  id: string
  name: string
  runtime: string
  enabled: number | boolean
  config_json?: string | null
}

/** 该 runtime 下可选项的档案(已启用的) */
export function filterEnabledProfiles<T extends ModelProfileLike>(profiles: T[], runtime: 'claude' | 'codex'): T[] {
  return profiles.filter((profile) => profile.runtime === runtime && (profile.enabled === 1 || profile.enabled === true))
}

/** 档案配置里的主模型名,作为选项副标题 */
export function profileModelLabel(configJson: string | null | undefined): string {
  if (!configJson) return ''
  try {
    const config = JSON.parse(configJson) as { model?: unknown; defaultModel?: unknown }
    if (typeof config.model === 'string' && config.model) return config.model
    if (typeof config.defaultModel === 'string' && config.defaultModel) return config.defaultModel
    return ''
  } catch {
    return ''
  }
}
