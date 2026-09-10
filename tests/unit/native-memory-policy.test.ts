import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { applyNativeMemoryPolicy, nativeMemorySettings } from '../../src/acp/native-memory-policy.js'

const temp = mkdtempSync(resolve(tmpdir(), 'native-memory-'))
afterEach(() => { vi.unstubAllEnvs(); rmSync(temp, { recursive: true, force: true }) })

test('memory follows identity, not cwd, and does not change authentication homes', () => {
  vi.stubEnv('DATA_DIR', temp)
  const first = { CLAUDE_CONFIG_DIR: 'original', CODEX_HOME: 'original' }
  applyNativeMemoryPolicy('claude', { id: 'a', project_id: 'p' }, first)
  const second = {}
  applyNativeMemoryPolicy('claude', { id: 'b', project_id: 'p' }, second)
  expect(nativeMemorySettings(first)?.autoMemoryDirectory).toBe(resolve(temp, 'agent-memory/p/a/claude'))
  expect(nativeMemorySettings(second)).not.toEqual(nativeMemorySettings(first))
  expect(first.CLAUDE_CONFIG_DIR).toBe('original')
  expect(first.CODEX_HOME).toBe('original')
})

test('Codex overrides memory flags while preserving flat and nested unrelated configuration', () => {
  const env = { CODEX_CONFIG: JSON.stringify({ model: 'm', features: { memories: true, hooks: true }, 'features.memories': true, memories: { use_memories: true } }) }
  applyNativeMemoryPolicy('codex', { id: 'a', project_id: null }, env)
  const config = JSON.parse(env.CODEX_CONFIG)
  expect(config.model).toBe('m')
  expect(config.features.hooks).toBe(true)
  expect(config['features.memories']).toBe(false)
  expect(config.features.memories).toBe(false)
  expect(config.memories.use_memories).toBe(false)
})

test('invalid override or path identity cannot silently fall back to shared memory', () => {
  expect(() => applyNativeMemoryPolicy('codex', { id: 'a', project_id: null }, { CODEX_CONFIG: '{' })).toThrow()
  expect(() => applyNativeMemoryPolicy('claude', { id: '../a', project_id: null }, {})).toThrow()
})
