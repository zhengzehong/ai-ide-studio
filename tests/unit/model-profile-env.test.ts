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
    expect(result.env.OTHER_ENV).toBe('kept')
    expect(result.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:29000/anthropic')
    expect(result.env.ANTHROPIC_API_KEY).toBe('sk-test')
    expect(result.env.ANTHROPIC_MODEL).toBe('deepseek-v4-flash')
    expect(result.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash')
    expect(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-v4-pro[1m]')
    expect(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('deepseek-v4-pro[1m]')
    expect(result.env.ANTHROPIC_REASONING_MODEL).toBe('deepseek-v4-flash')
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
    }

    const changed = { ...env, ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]' }

    expect(fingerprintRuntimeEnv(env, 'claude')).not.toBe(fingerprintRuntimeEnv(changed, 'claude'))
    expect(summarizeRuntimeEnv(env, 'claude')).toMatchObject({
      anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
      anthropicModel: 'deepseek-v4-flash',
      anthropicDefaultHaikuModel: 'deepseek-v4-flash',
      anthropicDefaultSonnetModel: 'deepseek-v4-flash',
      anthropicDefaultOpusModel: 'deepseek-v4-flash',
      anthropicReasoningModel: 'deepseek-v4-flash',
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
            env: {
              ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
              ANTHROPIC_API_KEY: 'sk-test',
              ANTHROPIC_AUTH_TOKEN: '',
              ANTHROPIC_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
              ANTHROPIC_REASONING_MODEL: 'deepseek-v4-flash',
            },
          },
        },
      },
    })
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
