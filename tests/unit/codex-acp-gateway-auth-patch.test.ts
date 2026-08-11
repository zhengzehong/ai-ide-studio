import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { CODEX_GATEWAY_API_KEY_ENV_KEY } from '../../src/acp/model-profile-env.js'

const require = createRequire(import.meta.url)

describe('codex-acp gateway authentication patch', () => {
  test('uses the profile process key instead of a static Authorization header', () => {
    const entryPath = require.resolve('@agentclientprotocol/codex-acp')
    const source = readFileSync(entryPath, 'utf8')

    expect(source).toContain(`env_key: "${CODEX_GATEWAY_API_KEY_ENV_KEY}"`)
    expect(source).toContain('delete headers.Authorization')
    expect(source).toContain('delete headers.authorization')
  })
})
