import { describe, expect, test } from 'vitest'
import { createWidgetNavigationUrl } from '../../electron/widget-navigation.js'

describe('Electron Widget navigation', () => {
  test('builds a project-scoped Workspace URL for a Session', () => {
    expect(createWidgetNavigationUrl('https://studio.example', {
      projectId: 'project/a',
      sessionId: 'session-1',
    })).toBe('https://studio.example/p/project%2Fa/workspace?sessionId=session-1')
  })

  test('falls back to the legacy Workspace only when a Session has no project', () => {
    expect(createWidgetNavigationUrl('http://127.0.0.1:18900', {
      projectId: null,
      sessionId: 'session-2',
    })).toBe('http://127.0.0.1:18900/workspace?sessionId=session-2')
  })

  test('does not create a navigation URL without a Session target', () => {
    expect(createWidgetNavigationUrl('http://127.0.0.1:18900')).toBeNull()
  })
})
