export type HotkeyScope = 'global' | 'workspace' | 'list' | 'input' | 'modal'
export type HotkeyCategory = 'page' | 'workspace' | 'session' | 'project' | 'general'

export interface HotkeyAction {
  id: string
  label: string
  category: HotkeyCategory
  scope: HotkeyScope
  defaultKeys: string
  run?: () => void
  keywords?: string
}

export const HOTKEY_ACTION_EVENT = 'ai-ide-hotkey-action'
export const HOTKEY_CHORD_EVENT = 'ai-ide-hotkey-chord'

const tuples = (
  category: HotkeyCategory,
  scope: HotkeyScope,
  values: Array<[string, string, string]>,
): HotkeyAction[] => values.map(([id, label, defaultKeys]) => ({ id, label, defaultKeys, category, scope, keywords: `${id} ${label}` }))

const pageActions = tuples('page', 'global', [
  ['page.dashboard', 'Dashboard', 'g d'], ['page.workspace', 'Workspace', 'g w'],
  ['page.tasks', 'Tasks', 'g t'], ['page.inspiration', 'Inspiration', 'g i'],
  ['page.knowledge', 'Knowledge', 'g k'], ['page.schedule', 'Schedule', 'g h'],
  ['page.events', 'Events', 'g e'], ['page.spreadsheets', 'Spreadsheets', 'g s'],
  ['page.reading', 'Reading', 'g r'], ['page.updates', 'Updates', 'g u'],
  ['page.agents', 'Agents', 'g a'], ['page.pinned', 'Pinned sessions', 'g p'],
])

const workspaceActions = tuples('workspace', 'workspace', [
  ['ws.focus-input', 'Focus input', 'tab'], ['ws.new-session', 'New session', 'c'],
  ['ws.focus-session-list', 'Focus session list', 'shift+tab'], ['ws.sidebar-tab-next', 'Next sidebar tab', 'alt+1'],
  ['ws.toggle-sidebar', 'Toggle sidebar', 'mod+b'],
])

const sessionActions = tuples('session', 'list', [
  ['session.next', 'Next session', 'j'], ['session.prev', 'Previous session', 'k'],
  ['session.next-unread', 'Next unread session', 'alt+j'], ['session.open', 'Open selected session', 'enter'],
  ['session.pin', 'Toggle session pin', 'p'], ['session.mark-unread', 'Mark session unread', 'u'],
  ['session.close', 'Close session', 'x'],
]).map((action) => ['session.pin', 'session.mark-unread', 'session.close'].includes(action.id)
  ? { ...action, scope: 'workspace' as HotkeyScope }
  : action.id === 'session.next-unread'
    ? { ...action, scope: 'global' as HotkeyScope }
    : action)

const projectActions = tuples('project', 'global', [
  ['project.tab-1', 'Project tab 1', 'mod+1'], ['project.tab-2', 'Project tab 2', 'mod+2'],
  ['project.tab-3', 'Project tab 3', 'mod+3'], ['project.tab-4', 'Project tab 4', 'mod+4'],
  ['project.tab-5', 'Project tab 5', 'mod+5'], ['project.recent', 'Previous project', 'alt+arrowleft'],
  ['project.next', 'Next project', 'mod+shift+]'], ['project.prev', 'Previous project', 'mod+shift+['],
])

const generalActions: HotkeyAction[] = [
  { id: 'app.palette', label: 'Command palette', category: 'general', scope: 'global', defaultKeys: 'mod+k', keywords: 'command palette search' },
  { id: 'app.hotkey-settings', label: 'Shortcut settings', category: 'general', scope: 'global', defaultKeys: 'mod+/', keywords: 'hotkey shortcut settings' },
]

export const HOTKEY_ACTIONS: HotkeyAction[] = [...pageActions, ...workspaceActions, ...sessionActions, ...projectActions, ...generalActions]

export function getHotkeyAction(actionId: string): HotkeyAction | undefined {
  return HOTKEY_ACTIONS.find((action) => action.id === actionId)
}

export interface HotkeyActionDetail { actionId: string }

export function dispatchHotkeyAction(actionId: string): void {
  window.dispatchEvent(new CustomEvent<HotkeyActionDetail>(HOTKEY_ACTION_EVENT, { detail: { actionId } }))
}

export function subscribeHotkeyActions(listener: (actionId: string) => void): () => void {
  const onAction = (event: Event): void => {
    const detail = (event as CustomEvent<HotkeyActionDetail>).detail
    if (detail?.actionId) listener(detail.actionId)
  }
  window.addEventListener(HOTKEY_ACTION_EVENT, onAction)
  return () => window.removeEventListener(HOTKEY_ACTION_EVENT, onAction)
}
