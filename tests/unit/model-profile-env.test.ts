import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  buildAgentSessionMeta,
  buildAgentRuntimeEnv,
  buildClaudeSessionMeta,
  fingerprintRuntimeEnv,
  summarizeRuntimeEnv,
} from '../../src/acp/model-profile-env.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { buildAiIdeSystemPrompt } from '../../src/core/ai-ide-system-prompt.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-model-profile-env-'))
let dbIndex = 0

const IMAGE_READ_DENY_RULES = [
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
]

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('model profile runtime env', () => {
  test('keeps existing runtime env when no model profile is bound', () => {
    const agent = agentStore.create({
      name: '默认 Claude',
      type: 'dev',
      runtime: 'claude',
    })

    const result = buildAgentRuntimeEnv('claude', agent, {
      ANTHROPIC_MODEL: 'system-default-model',
    })

    expect(result.appliedProfile).toBeUndefined()
    expect(result.env.ANTHROPIC_MODEL).toBe('system-default-model')
    expect(result.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(result.env.AI_IDE_CLAUDE_ALLOW_IMAGE_READ).toBe('0')
  })

  test('injects Claude model profile settings into the runtime process env', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000/',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'claude ds flash',
      runtime: 'claude',
      providerId: provider.id,
      contextWindow: 128000,
      config: {
        defaultModel: 'deepseek-v4-flash',
        haikuModel: 'deepseek-v4-flash',
        sonnetModel: 'deepseek-v4-pro[1m]',
        opusModel: 'deepseek-v4-pro[1m]',
      },
    })
    const agent = agentStore.create({
      name: '文档工程师',
      type: 'doc',
      runtime: 'claude',
      config: { modelProfileId: profile.id },
    })

    const result = buildAgentRuntimeEnv('claude', agent, {
      ANTHROPIC_MODEL: 'system-default-model',
      OTHER_ENV: 'kept',
    })

    expect(result.appliedProfile?.id).toBe(profile.id)
    expect(result.appliedProfile?.contextWindow).toBe(128000)
    expect(result.env.OTHER_ENV).toBe('kept')
    expect(result.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:29000/anthropic')
    expect(result.env.ANTHROPIC_API_KEY).toBe('sk-test')
    expect(result.env.ANTHROPIC_MODEL).toBe('deepseek-v4-flash')
    expect(result.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash')
    expect(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-v4-pro[1m]')
    expect(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('deepseek-v4-pro[1m]')
    expect(result.env.ANTHROPIC_REASONING_MODEL).toBe('deepseek-v4-flash')
    expect(result.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000')
    expect(result.env.AI_IDE_CLAUDE_ALLOW_IMAGE_READ).toBe('0')
  })

  test('includes Claude model profile env in fingerprints and safe summaries', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
      ANTHROPIC_REASONING_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '128000',
      AI_IDE_CLAUDE_ALLOW_IMAGE_READ: '0',
    }

    const changed = { ...env, ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]' }
    const changedContextWindow = { ...env, CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000' }
    const changedImageReadPolicy = { ...env, AI_IDE_CLAUDE_ALLOW_IMAGE_READ: '1' }

    expect(fingerprintRuntimeEnv(env, 'claude')).not.toBe(fingerprintRuntimeEnv(changed, 'claude'))
    expect(fingerprintRuntimeEnv(env, 'claude')).not.toBe(fingerprintRuntimeEnv(changedContextWindow, 'claude'))
    expect(fingerprintRuntimeEnv(env, 'claude')).not.toBe(fingerprintRuntimeEnv(changedImageReadPolicy, 'claude'))
    expect(summarizeRuntimeEnv(env, 'claude')).toMatchObject({
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
      anthropicModel: 'deepseek-v4-flash',
      anthropicDefaultHaikuModel: 'deepseek-v4-flash',
      anthropicDefaultSonnetModel: 'deepseek-v4-flash',
      anthropicDefaultOpusModel: 'deepseek-v4-flash',
      anthropicReasoningModel: 'deepseek-v4-flash',
      claudeCodeMaxContextTokens: '128000',
      allowImageRead: false,
      hasClaudeModelConfig: false,
    })
    expect(summarizeRuntimeEnv(env, 'claude').anthropicApiKeyHash).not.toBe('sk-test')
  })

  test('builds Claude session settings env from the bound model profile', () => {
    const provider = modelProviderStore.create({
      name: 'deepseek',
      displayName: 'DeepSeek',
      protocol: 'claude',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'claude ds flash',
      runtime: 'claude',
      providerId: provider.id,
      contextWindow: 200000,
      config: {
        defaultModel: 'deepseek-v4-flash',
        haikuModel: 'deepseek-v4-flash',
        sonnetModel: 'deepseek-v4-flash',
        opusModel: 'deepseek-v4-flash',
      },
    })
    const agent = agentStore.create({
      name: 'Claude',
      type: 'dev',
      runtime: 'claude',
      config: { modelProfileId: profile.id },
    })
    const { env } = buildAgentRuntimeEnv('claude', agent, {
      ANTHROPIC_MODEL: 'system-default-model',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'system-opus-model',
    })

    const meta = buildClaudeSessionMeta(env, 'claude')

    expect(meta).toEqual({
      claudeCode: {
        options: {
          settings: {
            autoCompactWindow: 200000,
            permissions: {
              deny: IMAGE_READ_DENY_RULES,
            },
            env: {
              ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
              ANTHROPIC_API_KEY: 'sk-test',
              ANTHROPIC_AUTH_TOKEN: '',
              ANTHROPIC_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_REASONING_MODEL: 'deepseek-v4-flash',
              CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000',
            },
          },
        },
      },
    })
  })

  test('omits auto compact settings when no valid context window is configured', () => {
    expect(buildClaudeSessionMeta({ ANTHROPIC_MODEL: 'glm5-prd' }, 'claude')).toEqual({
      claudeCode: {
        options: {
          settings: {
            permissions: {
              deny: IMAGE_READ_DENY_RULES,
            },
            env: {
              ANTHROPIC_AUTH_TOKEN: '',
              ANTHROPIC_MODEL: 'glm5-prd',
            },
          },
        },
      },
    })
  })

  test('injects only image permissions when no Claude model environment is configured', () => {
    expect(buildClaudeSessionMeta({}, 'claude')).toEqual({
      claudeCode: {
        options: {
          settings: {
            permissions: {
              deny: IMAGE_READ_DENY_RULES,
            },
          },
        },
      },
    })
  })

  test('allows image Read only when the Claude model profile explicitly enables it', () => {
    const provider = modelProviderStore.create({
      name: 'vision-provider',
      displayName: 'Vision Provider',
      protocol: 'claude',
      baseUrl: 'https://example.com/anthropic',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'vision-profile',
      runtime: 'claude',
      providerId: provider.id,
      config: {
        defaultModel: 'vision-model',
        allowImageRead: false,
      },
    })
    const agent = agentStore.create({
      name: 'Claude Vision',
      type: 'dev',
      runtime: 'claude',
      config: { modelProfileId: profile.id },
    })

    const disabled = buildAgentRuntimeEnv('claude', agent, {})
    expect(disabled.env.AI_IDE_CLAUDE_ALLOW_IMAGE_READ).toBe('0')
    expect(buildClaudeSessionMeta(disabled.env, 'claude')?.claudeCode.options.settings.permissions).toEqual({
      deny: IMAGE_READ_DENY_RULES,
    })

    modelProfileStore.update(profile.id, {
      config: {
        defaultModel: 'vision-model',
        allowImageRead: true,
      },
    })
    const enabled = buildAgentRuntimeEnv('claude', agent, {})
    expect(enabled.env.AI_IDE_CLAUDE_ALLOW_IMAGE_READ).toBe('1')
    expect(buildClaudeSessionMeta(enabled.env, 'claude')?.claudeCode.options.settings.permissions).toBeUndefined()
  })

  test('builds Claude session meta with appended agent system prompt', () => {
    const provider = modelProviderStore.create({
      name: 'deepseek',
      displayName: 'DeepSeek',
      protocol: 'claude',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'claude ds flash',
      runtime: 'claude',
      providerId: provider.id,
      config: {
        defaultModel: 'deepseek-v4-flash',
      },
    })
    const agent = agentStore.create({
      name: 'Claude',
      type: 'dev',
      runtime: 'claude',
      config: { modelProfileId: profile.id },
      systemPrompt: '  Follow the project rules.  ',
    })
    const { env } = buildAgentRuntimeEnv('claude', agent, {})

    const meta = buildAgentSessionMeta('claude', env, agent)

    expect(meta).toMatchObject({
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: `${buildAiIdeSystemPrompt()}\n\n---\n\nFollow the project rules.`,
      },
      claudeCode: {
        options: {
          settings: {
            env: {
              ANTHROPIC_MODEL: 'deepseek-v4-flash',
            },
          },
        },
      },
    })
  })

  test('builds Codex session meta with plain agent system prompt', () => {
    const agent = agentStore.create({
      name: 'Codex',
      type: 'dev',
      runtime: 'codex',
      systemPrompt: '  Follow the project rules.  ',
    })

    expect(buildAgentSessionMeta('codex', {}, agent)).toEqual({
      systemPrompt: `${buildAiIdeSystemPrompt()}\n\n---\n\nFollow the project rules.`,
    })
  })

  test('injects platform prompt when agent has no system prompt', () => {
    const agent = agentStore.create({
      name: 'NoPrompt',
      type: 'dev',
      runtime: 'codex',
    })

    expect(buildAgentSessionMeta('codex', {}, agent)).toEqual({
      systemPrompt: buildAiIdeSystemPrompt(),
    })
  })
})
