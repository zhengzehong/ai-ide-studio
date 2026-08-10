import type {
  ModelProfileConfig,
  ModelProfileData,
  ModelProviderData,
} from '../../stores/model.store'

export type ModelProfileRuntime = 'claude' | 'codex'

export function isCompatibleProvider(runtime: ModelProfileRuntime, protocol: string): boolean {
  if (protocol === 'new-api') return true
  return runtime === 'claude' ? protocol === 'claude' : protocol === 'openai'
}

export function compatibleProviders(
  providers: ModelProviderData[],
  runtime: ModelProfileRuntime,
): ModelProviderData[] {
  return providers.filter((provider) => isCompatibleProvider(runtime, provider.protocol))
}

export function providerModelIds(provider: ModelProviderData | undefined): string[] {
  if (!provider) return []
  try {
    const parsed: unknown = JSON.parse(provider.models_json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const value = entry as Record<string, unknown>
      return typeof value.id === 'string' && value.id.trim() ? [value.id.trim()] : []
    })
  } catch {
    return []
  }
}

export function parseProfileConfig(profile: ModelProfileData): ModelProfileConfig {
  try {
    return JSON.parse(profile.config_json) as ModelProfileConfig
  } catch {
    return profile.runtime === 'claude' ? { defaultModel: '' } : { model: '' }
  }
}
