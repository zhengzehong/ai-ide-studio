import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { CODEX_GATEWAY_API_KEY_ENV_KEY } from '../../src/acp/model-profile-env.js'

const require = createRequire(import.meta.url)

// codex-acp 1.10.0 原生保留 Authorization 头(0.0.44 时代由 patch 删除);
// 平台安全语义 = key 只经 profile 进程 env 传递,不进静态 http_headers(防随 config 落盘)。
describe('codex-acp gateway authentication patch', () => {
  test('uses the profile process key instead of a static Authorization header', () => {
    const entryPath = require.resolve('@agentclientprotocol/codex-acp')
    const source = readFileSync(entryPath, 'utf8')

    expect(source).toContain(`env_key: "${CODEX_GATEWAY_API_KEY_ENV_KEY}"`)
    expect(source).toContain('delete headers.Authorization')
    expect(source).toContain('delete headers.authorization')
    // 平台 systemPrompt 通道依赖 patch 注入的 getSystemPrompt
    expect(source).toContain('function getSystemPrompt(meta)')
  })
})
