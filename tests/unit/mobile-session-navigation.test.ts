import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  pinnedSessionsPath,
  resolveSessionViewMode,
  sessionViewPath,
} from '../../mobile/src/pages/session-view-mode'
import { resolveAndroidBackAction } from '../../mobile/src/components/AndroidBackHandler'
import { resolveChatReturnTo } from '../../mobile/src/pages/ChatPage'

describe('mobile session navigation', () => {
  test('keeps the normal project-organized session view as the default', () => {
    expect(resolveSessionViewMode('')).toBe('all')
    expect(resolveSessionViewMode('?view=all')).toBe('all')
    expect(sessionViewPath('all')).toBe('/')
  })

  test('addresses the embedded pinned view through the session route', () => {
    expect(resolveSessionViewMode('?view=pinned')).toBe('pinned')
    expect(sessionViewPath('pinned')).toBe('/?view=pinned')
    expect(pinnedSessionsPath).toBe('/?view=pinned')
  })

  test('returns to activity and embedded pinned views after opening chat', () => {
    expect(resolveChatReturnTo({ returnTo: '/activity' })).toBe('/activity')
    expect(resolveChatReturnTo({ returnTo: '/?view=pinned' })).toBe('/?view=pinned')
    expect(resolveAndroidBackAction('/chat/session-1', 'http://localhost', '/activity'))
      .toEqual({ type: 'navigate', to: '/activity' })
    expect(resolveAndroidBackAction('/chat/session-1', 'http://localhost', '/?view=pinned'))
      .toEqual({ type: 'navigate', to: '/?view=pinned' })
  })

  test('uses four bottom tabs and redirects the legacy pinned route', () => {
    const shell = readFileSync(resolve('mobile/src/components/MobileShell.tsx'), 'utf8')
    const app = readFileSync(resolve('mobile/src/App.tsx'), 'utf8')

    expect(shell).toContain("{ path: '/activity', label: '动态'")
    expect(shell).toContain("{ path: '/', label: '会话'")
    expect(shell).not.toContain("label: '置顶'")
    expect(shell).not.toContain("label: '秘书'")
    expect(app).toContain('path="/activity"')
    expect(app).toContain('to="/?view=pinned"')
  })
})
