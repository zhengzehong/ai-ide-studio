import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const patchPath = resolve(process.cwd(), 'patches/@agentclientprotocol+codex-acp+0.0.44.patch')

describe('codex-acp patch', () => {
  test('fork support does not rely on experimental excludeTurns', () => {
    const patch = readFileSync(patchPath, 'utf8')

    expect(patch).toContain('async forkSession(request)')
    expect(patch).toContain('threadFork')
    expect(patch).not.toContain('excludeTurns: true')
  })
})
