import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { globalAssistantRpcHandlers } from '../../src/gateway/rpc/global-assistant.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { templateStore } from '../../src/store/agent-templates.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-global-assistant-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('global assistant RPC', () => {
  test('binds selected model profile when configuring from template', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Claude Flash',
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'deepseek-v4-flash' },
    })
    const template = templateStore.create({
      name: '全局助理',
      type: 'pm',
      runtime: 'claude',
      systemPrompt: '整理项目上下文',
    })

    const result = callRpc('globalAssistant.setTemplate', {
      type: 'globalAssistant.setTemplate',
      templateId: template.id,
      modelProfileId: profile.id,
    })

    const agent = asRecord(result.agent)
    expect(JSON.parse(String(agent.config_json))).toMatchObject({
      templateId: template.id,
      modelProfileId: profile.id,
    })
  })

  test('updates and clears model profile for existing global assistant', () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const firstProfile = modelProfileStore.create({
      name: 'Claude Flash',
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'deepseek-v4-flash' },
    })
    const secondProfile = modelProfileStore.create({
      name: 'Claude Pro',
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'deepseek-v4-pro' },
    })
    const template = templateStore.create({
      name: '全局助理',
      type: 'pm',
      runtime: 'claude',
      systemPrompt: '整理项目上下文',
    })

    callRpc('globalAssistant.setTemplate', {
      type: 'globalAssistant.setTemplate',
      templateId: template.id,
      modelProfileId: firstProfile.id,
    })
    const updated = callRpc('globalAssistant.setTemplate', {
      type: 'globalAssistant.setTemplate',
      templateId: template.id,
      modelProfileId: secondProfile.id,
    })

    expect(readModelProfileId(updated)).toBe(secondProfile.id)

    const cleared = callRpc('globalAssistant.setTemplate', {
      type: 'globalAssistant.setTemplate',
      templateId: template.id,
      modelProfileId: null,
    })

    expect(readModelProfileId(cleared)).toBeUndefined()
  })
})

function callRpc(type: keyof typeof globalAssistantRpcHandlers, msg: Record<string, unknown>): Record<string, unknown> {
  let result: unknown
  globalAssistantRpcHandlers[type](msg as never, {
    state: { subscriptions: new Set<string>() },
    sendResult: (data) => { result = data },
    sendError: (message) => { throw new Error(message) },
    sendOutOfBandError: (message) => { throw new Error(message) },
  } satisfies RpcContext)
  return asRecord(result)
}

function readModelProfileId(payload: Record<string, unknown>): string | undefined {
  const agent = asRecord(payload.agent)
  const config = JSON.parse(String(agent.config_json ?? '{}')) as Record<string, unknown>
  return typeof config.modelProfileId === 'string' ? config.modelProfileId : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected record')
  return value as Record<string, unknown>
}
