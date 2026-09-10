import type { ModelProfileRow } from '../store/model-profiles.js'
import type { ModelProviderRow } from '../store/model-providers.js'
import { normalizeClaudeBaseUrl, normalizeOpenAiBaseUrl } from '../shared/model-provider-connection.js'
import { getCaptureSettings } from './capture-config.js'
import { describeCaptureRoute, type CaptureRouteBinding } from './route-bindings.js'

export function buildCaptureBinding(
  agentId: string,
  resolved: { profile: ModelProfileRow; provider: ModelProviderRow },
): CaptureRouteBinding | undefined {
  if (!getCaptureSettings().enabled) return undefined
  const { profile, provider } = resolved
  return describeCaptureRoute({
    agentId, runtime: profile.runtime, profileId: profile.id, providerId: provider.id,
    protocol: provider.protocol, apiKey: provider.api_key.trim(), providerName: provider.display_name,
    baseUrl: profile.runtime === 'codex'
      ? normalizeOpenAiBaseUrl(provider.base_url)
      : normalizeClaudeBaseUrl(provider.base_url, provider.protocol),
  })
}
