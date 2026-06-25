import { createHash } from 'crypto'
import type { AgentRow } from '../store/agents.js'
import { modelProfileStore, type ClaudeModelProfileConfig, type ModelProfileRow } from '../store/model-profiles.js'
import { modelProviderStore, type ModelProviderRow } from '../store/model-providers.js'
import { buildRuntimeEnv } from './runtime-registry.js'
import { buildAiIdeSystemPrompt } from '../core/ai-ide-system-prompt.js'

export interface AppliedModelProfile {
  id: string
  name: string
  runtime: string
  providerId: string
}

export interface AgentRuntimeEnvResult {
  env: NodeJS.ProcessEnv
  appliedProfile?: AppliedModelProfile
}

export interface ClaudeSessionMeta extends Record<string, unknown> {
  claudeCode: {
    options: {
      settings: {
        env: Record<string, string>
      }
    }
  }
}

export interface AgentSessionMeta extends Record<string, unknown> {
  systemPrompt?: string | {
    type: 'preset'
    preset: 'claude_code'
    append: string
  }
  claudeCode?: ClaudeSessionMeta['claudeCode']
}

const CLAUDE_PROFILE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_REASONING_MODEL',
] as const

export function buildAgentRuntimeEnv(
  runtime: string,
  agent: AgentRow,
  baseEnv: NodeJS.ProcessEnv = process.env,
): AgentRuntimeEnvResult {
  const env = buildRuntimeEnv(runtime, baseEnv)
  const resolvedProfile = resolveAgentModelProfile(runtime, agent)
  if (!resolvedProfile) return { env }

  if (runtime !== 'claude') return { env }
  if (!applyClaudeModelProfileEnv(
    env,
    resolvedProfile.provider,
    parseClaudeConfig(resolvedProfile.profile.config_json),
  )) return { env }

  return { env, appliedProfile: resolvedProfile.appliedProfile }
}

export function buildClaudeSessionMeta(env: NodeJS.ProcessEnv, runtime: string): ClaudeSessionMeta | undefined {
  if (runtime !== 'claude' || !env.ANTHROPIC_MODEL?.trim()) return undefined

  const settingsEnv = Object.fromEntries(
    CLAUDE_PROFILE_ENV_KEYS.map(key => [key, env[key]?.trim() ?? '']).filter(([, value]) => value !== ''),
  )
  settingsEnv.ANTHROPIC_AUTH_TOKEN = ''

  return {
    claudeCode: {
      options: {
        settings: {
          env: settingsEnv,
        },
      },
    },
  }
}

export function buildAgentSessionMeta(
  runtime: string,
  env: NodeJS.ProcessEnv,
  agent: AgentRow,
): AgentSessionMeta | undefined {
  const platformPrompt = buildAiIdeSystemPrompt()
  const userPrompt = agent.system_prompt.trim()
  const combined = userPrompt ? `${platformPrompt}\n\n---\n\n${userPrompt}` : platformPrompt

  const meta: AgentSessionMeta = {}

  if (combined) {
    meta.systemPrompt = runtime === 'claude'
      ? { type: 'preset', preset: 'claude_code', append: combined }
      : combined
  }

  const claudeMeta = buildClaudeSessionMeta(env, runtime)
  if (claudeMeta) meta.claudeCode = claudeMeta.claudeCode

  return Object.keys(meta).length > 0 ? meta : undefined
}

export function fingerprintRuntimeEnv(env: NodeJS.ProcessEnv, runtime: string): string {
  const keys = runtime === 'claude'
    ? [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_REASONING_MODEL',
      'CLAUDE_MODEL_CONFIG',
    ]
    : ['CODEX_PATH', 'MODEL_PROVIDER', 'CODEX_CONFIG']
  return JSON.stringify(keys.map(key => [key, fingerprintValue(key, env[key])]))
}

export function summarizeRuntimeEnv(env: NodeJS.ProcessEnv, runtime: string): Record<string, string | boolean | null> {
  if (runtime !== 'claude') return {}
  return {
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? null,
    anthropicModel: env.ANTHROPIC_MODEL ?? null,
    anthropicDefaultHaikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null,
    anthropicDefaultSonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,
    anthropicDefaultOpusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
    anthropicReasoningModel: env.ANTHROPIC_REASONING_MODEL ?? null,
    anthropicApiKeyHash: hashCredential(env.ANTHROPIC_API_KEY),
    anthropicAuthTokenHash: hashCredential(env.ANTHROPIC_AUTH_TOKEN),
    hasClaudeModelConfig: Boolean(env.CLAUDE_MODEL_CONFIG?.trim()),
  }
}

function applyClaudeModelProfileEnv(
  env: NodeJS.ProcessEnv,
  provider: { protocol: string; base_url: string; api_key: string },
  config: ClaudeModelProfileConfig,
): boolean {
  const defaultModel = config.defaultModel.trim()
  if (!defaultModel) return false
  env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrl(provider.base_url, provider.protocol)
  env.ANTHROPIC_API_KEY = provider.api_key
  env.ANTHROPIC_MODEL = defaultModel
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel?.trim() || defaultModel
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel?.trim() || defaultModel
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel?.trim() || defaultModel
  env.ANTHROPIC_REASONING_MODEL = defaultModel
  return true
}

function fingerprintValue(key: string, value: string | undefined): string | null {
  if (value === undefined) return null
  if (key.includes('API_KEY') || key.includes('TOKEN')) return hashCredential(value)
  return value
}

function hashCredential(value: string | undefined): string | null {
  if (value === undefined) return null
  return createHash('sha256').update(value).digest('hex')
}

function normalizeClaudeBaseUrl(baseUrl: string, protocol: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (protocol !== 'new-api') return trimmed
  return trimmed.endsWith('/anthropic') ? trimmed : `${trimmed}/anthropic`
}

function resolveAgentModelProfile(
  runtime: string,
  agent: AgentRow,
): { profile: ModelProfileRow; provider: ModelProviderRow; appliedProfile: AppliedModelProfile } | undefined {
  const profileId = readModelProfileId(agent.config_json)
  if (!profileId) return undefined

  const profile = modelProfileStore.get(profileId)
  if (!profile || profile.enabled !== 1 || profile.runtime !== runtime) return undefined

  const provider = modelProviderStore.get(profile.provider_id)
  if (!provider || provider.enabled !== 1) return undefined

  return { profile, provider, appliedProfile: toAppliedModelProfile(profile) }
}

function toAppliedModelProfile(profile: ModelProfileRow): AppliedModelProfile {
  return {
    id: profile.id,
    name: profile.name,
    runtime: profile.runtime,
    providerId: profile.provider_id,
  }
}

function readModelProfileId(raw: string | null): string | undefined {
  const config = parseRecord(raw)
  const value = config.modelProfileId
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseClaudeConfig(raw: string): ClaudeModelProfileConfig {
  const config = parseRecord(raw)
  const defaultModel = typeof config.defaultModel === 'string' ? config.defaultModel.trim() : ''
  return {
    defaultModel,
    haikuModel: typeof config.haikuModel === 'string' ? config.haikuModel : undefined,
    sonnetModel: typeof config.sonnetModel === 'string' ? config.sonnetModel : undefined,
    opusModel: typeof config.opusModel === 'string' ? config.opusModel : undefined,
  }
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
