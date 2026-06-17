import { describe, expect, test } from 'vitest'

import { resolveAndroidBackAction } from '../../mobile/src/components/AndroidBackHandler.tsx'

describe('mobile android back handler', () => {
  test('returns to the session list from detail and secondary tabs', () => {
    expect(resolveAndroidBackAction('/chat/sess-1', 'http://127.0.0.1:18900')).toEqual({ type: 'navigate', to: '/' })
    expect(resolveAndroidBackAction('/tasks', 'http://127.0.0.1:18900')).toEqual({ type: 'navigate', to: '/' })
    expect(resolveAndroidBackAction('/settings', 'http://127.0.0.1:18900')).toEqual({ type: 'navigate', to: '/' })
  })

  test('returns from connect page when a server is configured', () => {
    expect(resolveAndroidBackAction('/connect', 'http://127.0.0.1:18900')).toEqual({ type: 'navigate', to: '/' })
  })

  test('exits from root or unconfigured connect page', () => {
    expect(resolveAndroidBackAction('/', 'http://127.0.0.1:18900')).toEqual({ type: 'exit' })
    expect(resolveAndroidBackAction('/connect', '')).toEqual({ type: 'exit' })
  })
})
