import { describe, expect, test } from 'vitest'
import { HOTKEY_ACTIONS } from '../../ui/src/lib/hotkey-actions.js'

describe('hotkey actions', () => {
  test('declares every page route action and unique defaults', () => {
    const pageIds = HOTKEY_ACTIONS.filter((action) => action.category === 'page').map((action) => action.id)
    expect(pageIds).toEqual(expect.arrayContaining([
      'page.dashboard', 'page.workspace', 'page.tasks', 'page.inspiration', 'page.knowledge',
      'page.schedule', 'page.events', 'page.spreadsheets', 'page.reading', 'page.updates',
      'page.agents', 'page.pinned',
    ]))
    const defaults = HOTKEY_ACTIONS.map((action) => action.defaultKeys)
    expect(new Set(defaults).size).toBe(defaults.length)
  })

  test('contains the workspace and session actions', () => {
    expect(HOTKEY_ACTIONS.map((action) => action.id)).toEqual(expect.arrayContaining([
      'ws.focus-input', 'ws.new-session', 'ws.focus-session-list', 'ws.sidebar-tab-next', 'ws.toggle-sidebar',
      'session.next', 'session.prev', 'session.next-unread', 'session.open', 'session.pin', 'session.mark-unread', 'session.close',
    ]))
  })
})
