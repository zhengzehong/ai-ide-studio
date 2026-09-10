import { createHash } from 'crypto'
import type { AgentRow } from '../store/agents.js'
import {
  modelProfileStore,
  type ClaudeModelProfileConfig,
  type CodexModelProfileConfig,
  type ModelProfileRow,
} from '../store/model-profiles.js'
import { modelProviderStore, type ModelProviderRow } from '../store/model-providers.js'
import { isProviderProtocolCompatible, normalizeOpenAiBaseUrl } from '../shared/model-provider-connection.js'
import { buildRuntimeEnv } from './runtime-registry.js'
import { buildAiIdeSystemPrompt } from '../core/ai-ide-system-prompt.js'
import { buildMasterPrompt } from '../core/master-prompt.js'
import { agentMemoryService } from '../core/agent-memory.js'
import {
  getGlobalModelProfile,
  readAgentModelProfileMode,
  readModelProfileId,
} from './runtime-global-model-profile.js'

export interface AppliedModelProfile {
  id: string
  name: string
  runtime: string
  providerId: string
  contextWindow?: number
  modelId?: string
  effort?: string
}

export interface RuntimeGatewayAuth {
  methodId: 'gateway'
  baseUrl: string
  providerName: string
  headers: Record<string, string>
  fingerprint: string
}

export interface AgentRuntimeEnvResult {
  env: NodeJS.ProcessEnv
  appliedProfile?: AppliedModelProfile
  gatewayAuth?: RuntimeGatewayAuth
}

export interface AgentRuntimeEnvOptions {
  /** Team member-level profile override. Undefined keeps the Agent's existing strategy. */
  modelProfileIdOverride?: string
}

export interface ClaudeSessionMeta extends Record<string, unknown> {
  claudeCode: {
    options: {
      disallowedTools?: string[]
      settings: {
        autoCompactWindow?: number
        permissions?: {
          deny: string[]
        }
        env?: Record<string, string>
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
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_REASONING_MODEL',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
] as const

const CLAUDE_IMAGE_READ_POLICY_ENV_KEY = 'AI_IDE_CLAUDE_ALLOW_IMAGE_READ'
export const CODEX_GATEWAY_API_KEY_ENV_KEY = 'AI_IDE_CODEX_GATEWAY_API_KEY'
const CLAUDE_IMAGE_READ_DENY_RULES = [
  'Read(**/*.png)',
  'Read(**/*.jpg)',
  'Read(**/*.jpeg)',
  'Read(**/*.webp)',
  'Read(**/*.gif)',
  'Read(**/*.bmp)',
  'Read(**/*.ico)',
  'Read(**/*.avif)',
  'Read(**/*.tif)',
  'Read(**/*.tiff)',
  'Read(**/*.heic)',
  'Read(**/*.pdf)',
] as const

const CLAUDE_DISABLED_BUILTIN_TOOLS = [
  'Workflow',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'AskUserQuestion',
  'WebSearch',
  'WebFetch',
] as const

export function buildAgentRuntimeEnv(
  runtime: string,
  agent: AgentRow,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: AgentRuntimeEnvOptions = {},
): AgentRuntimeEnvResult {
  const env = buildRuntimeEnv(runtime, baseEnv)
  if (runtime === 'claude') env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] = '0'
  if (runtime === 'codex') delete env[CODEX_GATEWAY_API_KEY_ENV_KEY]
  const resolvedProfile = resolveAgentModelProfile(runtime, agent, options.modelProfileIdOverride)
  if (!resolvedProfile) return { env }

  if (runtime === 'codex') {
    const config = parseCodexConfig(resolvedProfile.profile.config_json)
    if (!config.model || !isProviderProtocolCompatible('codex', resolvedProfile.provider.protocol)) return { env }
    const apiKey = resolvedProfile.provider.api_key.trim()
    if (apiKey) env[CODEX_GATEWAY_API_KEY_ENV_KEY] = apiKey
    return {
      env,
      appliedProfile: {
        ...resolvedProfile.appliedProfile,
        modelId: config.model,
        ...(config.effort ? { effort: config.effort } : {}),
      },
      gatewayAuth: buildCodexGatewayAuth(resolvedProfile.provider),
    }
  }

  const config = parseClaudeConfig(resolvedProfile.profile.config_json)
  if (!isProviderProtocolCompatible('claude', resolvedProfile.provider.protocol)) return { env }
  if (!applyClaudeModelProfileEnv(
    env,
    resolvedProfile.provider,
    config,
    resolvedProfile.appliedProfile.contextWindow,
  )) return { env }

  return {
    env,
    appliedProfile: { ...resolvedProfile.appliedProfile, modelId: config.defaultModel },
  }
}

export function buildClaudeSessionMeta(env: NodeJS.ProcessEnv, runtime: string): ClaudeSessionMeta | undefined {
  if (runtime !== 'claude') return undefined

  const hasModelSettings = Boolean(env.ANTHROPIC_MODEL?.trim())
  const settingsEnv = hasModelSettings
    ? Object.fromEntries(
      CLAUDE_PROFILE_ENV_KEYS.map(key => [key, env[key]?.trim() ?? '']).filter(([, value]) => value !== ''),
    )
    : undefined
  if (settingsEnv) settingsEnv.ANTHROPIC_AUTH_TOKEN = ''
  const autoCompactWindow = parseAutoCompactWindow(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)
  const allowImageRead = env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] === '1'

  return {
    claudeCode: {
      options: {
        disallowedTools: [...CLAUDE_DISABLED_BUILTIN_TOOLS],
        settings: {
          ...(autoCompactWindow ? { autoCompactWindow } : {}),
          ...(!allowImageRead ? { permissions: { deny: [...CLAUDE_IMAGE_READ_DENY_RULES] } } : {}),
          ...(settingsEnv ? { env: settingsEnv } : {}),
        },
      },
    },
  }
}

function parseAutoCompactWindow(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 100_000 && parsed <= 1_000_000
    ? parsed
    : undefined
}

export function buildAgentSessionMeta(
  runtime: string,
  env: NodeJS.ProcessEnv,
  agent: AgentRow,
  options: { isPrimary?: boolean; additionalPrompt?: string } = {},
): AgentSessionMeta | undefined {
  const platformPrompt = buildAiIdeSystemPrompt()
  const userPrompt = agent.system_prompt.trim()
  let combined = userPrompt ? `${platformPrompt}\n\n---\n\n${userPrompt}` : platformPrompt
  if (options.isPrimary) {
    combined = `${combined}\n\n---\n\n${buildMasterPrompt(agent.name)}`
  }
  if (options.additionalPrompt?.trim()) {
    combined = `${combined}\n\n---\n\n${options.additionalPrompt.trim()}`
  }
  const memoryPrompt = agentMemoryService.buildAgentMemoryPrompt(agent.id)
  if (memoryPrompt) {
    combined = `${combined}\n\n---\n\n${memoryPrompt}`
  }

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
      'CLAUDE_CODE_SUBAGENT_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_REASONING_MODEL',
      'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
      'CLAUDE_MODEL_CONFIG',
      CLAUDE_IMAGE_READ_POLICY_ENV_KEY,
    ]
    : ['CODEX_PATH', 'MODEL_PROVIDER', 'CODEX_CONFIG', CODEX_GATEWAY_API_KEY_ENV_KEY]
  return JSON.stringify(keys.map(key => [key, fingerprintValue(key, env[key])]))
}

export function summarizeRuntimeEnv(env: NodeJS.ProcessEnv, runtime: string): Record<string, string | boolean | null> {
  if (runtime !== 'claude') return {}
  return {
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? null,
    anthropicModel: env.ANTHROPIC_MODEL ?? null,
    claudeCodeSubagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
    anthropicDefaultHaikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null,
    anthropicDefaultSonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,
    anthropicDefaultOpusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
    anthropicReasoningModel: env.ANTHROPIC_REASONING_MODEL ?? null,
    claudeCodeMaxContextTokens: env.CLAUDE_CODE_MAX_CONTEXT_TOKENS ?? null,
    allowImageRead: env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] === '1',
    anthropicApiKeyHash: hashCredential(env.ANTHROPIC_API_KEY),
    anthropicAuthTokenHash: hashCredential(env.ANTHROPIC_AUTH_TOKEN),
    hasClaudeModelConfig: Boolean(env.CLAUDE_MODEL_CONFIG?.trim()),
  }
}

function applyClaudeModelProfileEnv(
  env: NodeJS.ProcessEnv,
  provider: { protocol: string; base_url: string; api_key: string },
  config: ClaudeModelProfileConfig,
  contextWindow?: number,
): boolean {
  const defaultModel = config.defaultModel.trim()
  if (!defaultModel) return false
  env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrl(provider.base_url, provider.protocol)
  env.ANTHROPIC_API_KEY = provider.api_key
  env.ANTHROPIC_AUTH_TOKEN = ''
  env.ANTHROPIC_MODEL = defaultModel
  env.CLAUDE_CODE_SUBAGENT_MODEL = 'inherit'
  applyOptionalEnv(env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL', config.haikuModel)
  applyOptionalEnv(env, 'ANTHROPIC_DEFAULT_SONNET_MODEL', config.sonnetModel)
  applyOptionalEnv(env, 'ANTHROPIC_DEFAULT_OPUS_MODEL', config.opusModel)
  env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] = config.allowImageRead === true ? '1' : '0'
  if (contextWindow) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(contextWindow)
  return true
}

function applyOptionalEnv(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  const normalized = value?.trim()
  if (normalized) env[key] = normalized
}

function buildCodexGatewayAuth(provider: ModelProviderRow): RuntimeGatewayAuth {
  const baseUrl = normalizeOpenAiBaseUrl(provider.base_url)
  const apiKey = provider.api_key.trim()
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  return {
    methodId: 'gateway',
    baseUrl,
    providerName: provider.display_name,
    headers,
    fingerprint: createHash('sha256').update(JSON.stringify({
      protocol: provider.protocol,
      baseUrl,
      apiKey,
    })).digest('hex'),
  }
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
  modelProfileIdOverride?: string,
): { profile: ModelProfileRow; provider: ModelProviderRow; appliedProfile: AppliedModelProfile } | undefined {
  const mode = runtime === 'claude' || runtime === 'codex'
    ? readAgentModelProfileMode(agent.config_json)
    : 'system'
  const explicitProfileId = readModelProfileId(agent.config_json)
  const globalState = runtime === 'claude' || runtime === 'codex'
    ? getGlobalModelProfile(runtime)
    : undefined
  const globalProfileId = globalState?.enabled ? globalState.profileId : undefined
  const profileId = modelProfileIdOverride?.trim() || (mode === 'fixed'
    ? explicitProfileId
    : mode === 'global'
      ? globalProfileId
      : undefined)
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
    contextWindow: normalizeContextWindow(profile.context_window),
  }
}

function normalizeContextWindow(value: number | null): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function parseClaudeConfig(raw: string): ClaudeModelProfileConfig {
  const config = parseRecord(raw)
  const defaultModel = typeof config.defaultModel === 'string' ? config.defaultModel.trim() : ''
  return {
    defaultModel,
    haikuModel: typeof config.haikuModel === 'string' ? config.haikuModel : undefined,
    sonnetModel: typeof config.sonnetModel === 'string' ? config.sonnetModel : undefined,
    opusModel: typeof config.opusModel === 'string' ? config.opusModel : undefined,
    allowImageRead: config.allowImageRead === true,
  }
}

function parseCodexConfig(raw: string): CodexModelProfileConfig {
  const config = parseRecord(raw)
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  const effort = typeof config.effort === 'string' ? config.effort.trim() : ''
  return { model, ...(effort ? { effort } : {}) }
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
