import { describe, expect, test, vi } from 'vitest'
import { openWidgetSession } from '../../ui/src/pages/widget/widget-session-action.js'

const session = {
  sessionId: 'session-1',
  projectId: 'project-1',
  unread: true,
}

describe('Widget Session action', () => {
  test('marks the Session read only after navigation succeeds', async () => {
    const order: string[] = []
    const openMain = vi.fn(async () => {
      order.push('navigate')
      return { ok: true }
    })
    const markRead = vi.fn(async () => { order.push('read') })

    await expect(openWidgetSession(session, openMain, markRead)).resolves.toBeNull()
    expect(order).toEqual(['navigate', 'read'])
  })

  test('keeps unread state when navigation reports a failure', async () => {
    const markRead = vi.fn()

    await expect(openWidgetSession(
      session,
      async () => ({ ok: false, error: '主窗口加载失败' }),
      markRead,
    )).resolves.toBe('主窗口加载失败')
    expect(markRead).not.toHaveBeenCalled()
  })

  test('keeps unread state when Electron IPC rejects', async () => {
    const markRead = vi.fn()

    await expect(openWidgetSession(
      session,
      async () => { throw new Error('IPC channel closed') },
      markRead,
    )).resolves.toBe('IPC channel closed')
    expect(markRead).not.toHaveBeenCalled()
  })
})
