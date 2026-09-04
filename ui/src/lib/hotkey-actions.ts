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
  ['page.dashboard', '打开概览', 'g d'], ['page.workspace', '打开工作空间', 'g w'],
  ['page.tasks', '打开任务看板', 'g t'], ['page.inspiration', '打开灵感', 'g i'],
  ['page.knowledge', '打开知识库', 'g k'], ['page.schedule', '打开排班', 'g h'],
  ['page.events', '打开事件中心', 'g e'], ['page.spreadsheets', '打开表格', 'g s'],
  ['page.reading', '打开阅读列表', 'g r'], ['page.updates', '打开会话动态', 'g u'],
  ['page.agents', '打开 Agent 广场', 'g a'], ['page.pinned', '打开置顶会话', 'g p'],
])

const workspaceActions = tuples('workspace', 'workspace', [
  ['ws.focus-input', '定位到输入框', 'tab'], ['ws.new-session', '新建会话', 'c'],
  ['ws.focus-session-list', '定位到会话列表', 'shift+tab'], ['ws.sidebar-tab-next', '切换侧边栏标签', 'alt+1'],
  ['ws.toggle-sidebar', '折叠或展开侧边栏', 'mod+b'],
])

const sessionActions = tuples('session', 'list', [
  ['session.next', '选择下一个会话', 'j'], ['session.prev', '选择上一个会话', 'k'],
  ['session.next-unread', '跳转到下一个未读会话', 'alt+j'], ['session.open', '打开选中的会话', 'enter'],
  ['session.pin', '置顶或取消置顶当前会话', 'p'], ['session.mark-unread', '标记当前会话未读', 'u'],
  ['session.close', '关闭当前会话', 'x'],
]).map((action) => ['session.pin', 'session.mark-unread', 'session.close'].includes(action.id)
  ? { ...action, scope: 'workspace' as HotkeyScope }
  : action.id === 'session.next-unread'
    ? { ...action, scope: 'global' as HotkeyScope }
    : action)

const projectActions = tuples('project', 'global', [
  ['project.tab-1', '切换到第一个项目', 'mod+1'], ['project.tab-2', '切换到第二个项目', 'mod+2'],
  ['project.tab-3', '切换到第三个项目', 'mod+3'], ['project.tab-4', '切换到第四个项目', 'mod+4'],
  ['project.tab-5', '切换到第五个项目', 'mod+5'], ['project.recent', '返回上一个项目', 'alt+arrowleft'],
  ['project.next', '切换到下一个项目', 'mod+shift+]'], ['project.prev', '切换到上一个项目', 'mod+shift+['],
])

const generalActions: HotkeyAction[] = [
  { id: 'app.palette', label: '打开命令面板', category: 'general', scope: 'global', defaultKeys: 'mod+k', keywords: 'command palette search 命令搜索' },
  { id: 'app.hotkey-settings', label: '打开快捷键设置', category: 'general', scope: 'global', defaultKeys: 'mod+/', keywords: 'hotkey shortcut settings 快捷键' },
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
