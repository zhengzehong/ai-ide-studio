import { describe, expect, test } from 'vitest'
import { resolveSessionRuntimeState } from '../../src/store/session-runtime-state.js'

describe('resolveSessionRuntimeState', () => {
  test.each([
    ['active prompt', { promptActive: true }],
    ['running agent message', { hasRunningAgentMessage: true }],
    ['running process item', { hasRunningProcessItem: true }],
    ['known running stage', { stage: '正在思考...' }],
  ])('reports running from %s evidence', (_label, override) => {
    expect(resolveSessionRuntimeState({
      promptActive: false,
      hasRunningAgentMessage: false,
      hasRunningProcessItem: false,
      status: 'active',
      stage: '',
      ...override,
    })).toBe('running')
  })

  test('reports a closed session idle when only its stale stage looks running', () => {
    expect(resolveSessionRuntimeState({
      promptActive: false,
      hasRunningAgentMessage: false,
      hasRunningProcessItem: false,
      status: 'closed',
      stage: '正在思考...',
    })).toBe('idle')
  })

  test('keeps explicit runtime evidence ahead of the persisted session status', () => {
    expect(resolveSessionRuntimeState({
      promptActive: false,
      hasRunningAgentMessage: true,
      hasRunningProcessItem: false,
      status: 'closed',
      stage: '',
    })).toBe('running')
  })
})
