import { createHash } from 'crypto'
import type { AgentRow } from '../store/agents.js'
import {
  modelProfileStore,
  type ClaudeModelProfileConfig,
  type ModelProfileRow,
} from '../store/model-profiles.js'
import { modelProviderStore, type ModelProviderRow } from '../store/model-providers.js'
import { isProviderProtocolCompatible, normalizeClaudeBaseUrl, normalizeOpenAiBaseUrl } from '../shared/model-provider-connection.js'
import { buildRuntimeEnv } from './runtime-registry.js'
import { parseClaudeConfig, parseCodexConfig } from './profile-config-parser.js'
import { applyNativeMemoryPolicy, nativeMemorySettings, NATIVE_MEMORY_DIRECTORY_ENV } from './native-memory-policy.js'
import { buildAiIdeSystemPrompt } from '../core/ai-ide-system-prompt.js'
import { buildMasterPrompt } from '../core/master-prompt.js'
import { buildTeamRuntimePrompt } from '../core/team-runtime-prompt.js'
import { agentMemoryService } from '../core/agent-memory.js'
import { buildCaptureBinding } from '../model-capture/profile-binding.js'
import type { CaptureRouteBinding } from '../model-capture/route-bindings.js'
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
  captureBinding?: CaptureRouteBinding
  appliedProfile?: AppliedModelProfile
  gatewayAuth?: RuntimeGatewayAuth
}

export interface AgentRuntimeEnvOptions {
  /** Team member-level profile override. Undefined keeps the Agent's existing strategy. */
  modelProfileIdOverride?: string
  /** 成员级默认档位（team_members.reasoning_effort）。写入 appliedProfile.effort，由既有
   *  applyConfigPreferences 通道下发为会话默认；会话里手切过的档位（runtime preferences）优先。 */
  effortOverride?: string
}

export interface ClaudeSessionMeta extends Record<string, unknown> {
  claudeCode: {
    options: {
      disallowedTools?: string[]
      settings: {
        autoMemoryDirectory?: string
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
/** 档位净化哨兵（a2）：非法值（CLI 视为"未设置"），见 buildClaudeSessionMeta 注释。严禁改为 'unset'/'auto'。 */
const CLAUDE_EFFORT_ENV_KEY = 'CLAUDE_CODE_EFFORT_LEVEL'
const EFFORT_ENV_NEUTRALIZED = 'default'
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
  applyNativeMemoryPolicy(runtime, agent, env)
  if (runtime === 'claude') env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] = '0'
  // claude 档位权威性（a1）：继承 env 会压过 ACP apply_flag_settings（界面档位），CLI 内部 att() 直读该变量。
  // 平台从未设置过这两个变量（CLAUDE_EFFORT 是 CLI 输出给子进程的），清掉无副作用；用户全局 settings.json 的
  // env 由 buildClaudeSessionMeta 的哨兵兜住（a2）。
  if (runtime === 'claude') {
    delete env.CLAUDE_CODE_EFFORT_LEVEL
    delete env.CLAUDE_EFFORT
  }
  if (runtime === 'codex') delete env[CODEX_GATEWAY_API_KEY_ENV_KEY]
  const resolvedProfile = resolveAgentModelProfile(runtime, agent, options.modelProfileIdOverride)
  if (!resolvedProfile) return { env }
  const effortOverride = options.effortOverride?.trim() || undefined

  if (runtime === 'codex') {
    const config = parseCodexConfig(resolvedProfile.profile.config_json)
    if (!config.model || !isProviderProtocolCompatible('codex', resolvedProfile.provider.protocol)) return { env }
    const apiKey = resolvedProfile.provider.api_key.trim()
    if (apiKey) env[CODEX_GATEWAY_API_KEY_ENV_KEY] = apiKey
    const captureBinding = buildCaptureBinding(agent.id, resolvedProfile)
    const effort = effortOverride ?? config.effort
    return {
      env,
      captureBinding,
      appliedProfile: {
        ...resolvedProfile.appliedProfile,
        modelId: config.model,
        ...(effort ? { effort } : {}),
      },
      gatewayAuth: buildCodexGatewayAuth(resolvedProfile.provider, captureBinding?.proxyBaseUrl),
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
  const captureBinding = buildCaptureBinding(agent.id, resolvedProfile)
  if (captureBinding) env.ANTHROPIC_BASE_URL = captureBinding.proxyBaseUrl

  return {
    env,
    captureBinding,
    appliedProfile: {
      ...resolvedProfile.appliedProfile,
      modelId: config.defaultModel,
      ...(effortOverride ? { effort: effortOverride } : {}),
    },
  }
}

export function buildClaudeSessionMeta(env: NodeJS.ProcessEnv, runtime: string): ClaudeSessionMeta | undefined {
  if (runtime !== 'claude') return undefined

  const hasModelSettings = Boolean(env.ANTHROPIC_MODEL?.trim())
  const settingsEnv = hasModelSettings
    ? Object.fromEntries(
      CLAUDE_PROFILE_ENV_KEYS.map(key => [key, env[key]?.trim() ?? '']).filter(([, value]) => value !== ''),
    )
    : {}
  if (hasModelSettings) settingsEnv.ANTHROPIC_AUTH_TOKEN = ''
  // a2 决定性修复：机器级 CLAUDE_CODE_EFFORT_LEVEL（用户全局 settings.json env / 继承 env）会在 CLI 启动时
  // in-process 重放进 process.env，压过 ACP apply_flag_settings（界面档位）。用**非法值** 'default' 注入会话
  // settings.env（flagSettings 层，后于 userSettings 应用）：CLI att() 对非合法档位返回 undefined＝未设置，
  // 档位回到界面所选。禁用 'unset'/'auto'（CLI 硬禁用语义：会移除 effort 字段并忽略界面选择）。
  settingsEnv[CLAUDE_EFFORT_ENV_KEY] = EFFORT_ENV_NEUTRALIZED
  const autoCompactWindow = parseAutoCompactWindow(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)
  const allowImageRead = env[CLAUDE_IMAGE_READ_POLICY_ENV_KEY] === '1'

  return {
    claudeCode: {
      options: {
        disallowedTools: [...CLAUDE_DISABLED_BUILTIN_TOOLS],
        settings: {
          ...nativeMemorySettings(env),
          ...(autoCompactWindow ? { autoCompactWindow } : {}),
          ...(!allowImageRead ? { permissions: { deny: [...CLAUDE_IMAGE_READ_DENY_RULES] } } : {}),
          env: settingsEnv,
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
  options: { isPrimary?: boolean; additionalPrompt?: string; sessionId?: string } = {},
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
  const teamPrompt = buildTeamRuntimePrompt(options.sessionId)
  if (teamPrompt) combined = `${combined}\n\n${teamPrompt}`
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
      NATIVE_MEMORY_DIRECTORY_ENV,
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

function buildCodexGatewayAuth(provider: ModelProviderRow, captureBaseUrl?: string): RuntimeGatewayAuth {
  const baseUrl = captureBaseUrl ?? normalizeOpenAiBaseUrl(provider.base_url)
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

export function resolveAgentModelProfile(
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
