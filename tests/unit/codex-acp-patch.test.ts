import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const patchPath = resolve(process.cwd(), 'patches/@agentclientprotocol+codex-acp+1.10.0.patch')

describe('codex-acp patch', () => {
  test('systemPrompt 通道经 developerInstructions 注入(1.10.0 原生不读 _meta.systemPrompt)', () => {
    const patch = readFileSync(patchPath, 'utf8')

    expect(patch).toContain('function getSystemPrompt(meta)')
    expect(patch.match(/developerInstructions: getSystemPrompt\(request\._meta\)/g)?.length).toBeGreaterThanOrEqual(3)
  })

  test('fork 由 1.10.0 原生承担,patch 不再注入 fork 实现', () => {
    const patch = readFileSync(patchPath, 'utf8')

    expect(patch).not.toContain('async forkSession(request)')
    expect(patch).not.toContain('unstable_forkSession')
    expect(patch).not.toContain('excludeTurns: true')
  })

  test('gateway 认证保持平台安全语义(删 Authorization 头 + env_key 传 key)', () => {
    const patch = readFileSync(patchPath, 'utf8')

    expect(patch).toContain('delete headers.Authorization')
    expect(patch).toContain('delete headers.authorization')
    expect(patch).toContain('env_key: "AI_IDE_CODEX_GATEWAY_API_KEY"')
  })
})
