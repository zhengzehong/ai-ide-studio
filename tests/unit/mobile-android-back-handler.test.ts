import { describe, expect, test, vi } from 'vitest'

import {
  registerAndroidBackListener,
  resolveAndroidBackAction,
  type AndroidBackSnapshot,
} from '../../mobile/src/components/AndroidBackHandler.tsx'

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

  test('removes delayed native listener when cleanup runs before registration resolves', async () => {
    let resolveHandle: (handle: { remove: () => Promise<void> }) => void = () => {}
    const remove = vi.fn(async () => {})
    const addListener = vi.fn(() => new Promise<{ remove: () => Promise<void> }>((resolve) => {
      resolveHandle = resolve
    }))
    const snapshot: AndroidBackSnapshot = {
      pathname: '/chat/sess-1',
      serverUrl: 'http://127.0.0.1:18900',
      navigate: vi.fn(),
    }

    const cleanup = registerAndroidBackListener({
      addListener,
      exitApp: vi.fn(async () => {}),
      getSnapshot: () => snapshot,
    })
    cleanup()
    resolveHandle({ remove })
    await Promise.resolve()

    expect(remove).toHaveBeenCalledTimes(1)
  })
})
