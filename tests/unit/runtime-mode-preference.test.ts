import { describe, expect, test } from 'vitest'
import { resolveDesiredRuntimeMode } from '../../src/acp/runtime-mode-preference.js'

describe('Runtime mode preference', () => {
  test('defaults Codex sessions to full access', () => {
    expect(resolveDesiredRuntimeMode('codex')).toBe('agent-full-access')
  })

  test('defaults Claude sessions to bypass permissions', () => {
    expect(resolveDesiredRuntimeMode('claude')).toBe('bypassPermissions')
  })

  test('prefers a saved mode over the runtime default', () => {
    expect(resolveDesiredRuntimeMode('codex', 'agent')).toBe('agent')
    expect(resolveDesiredRuntimeMode('claude', 'plan')).toBe('plan')
  })

  test('does not select a mode for an unknown runtime', () => {
    expect(resolveDesiredRuntimeMode('mock')).toBeUndefined()
  })
})
