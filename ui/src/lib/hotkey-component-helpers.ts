import { HOTKEY_ACTIONS, type HotkeyAction } from './hotkey-actions'
import { normalizeBinding } from './platform-key'

export function composeRecordedBinding(firstKey: string | null, nextKey: string): string {
  return normalizeBinding(firstKey ? `${firstKey} ${nextKey}` : nextKey)
}

export function resolvePinnedProjectId(pinnedIds: string[], projectIds: string[], index: number): string | null {
  const valid = pinnedIds.filter((id) => projectIds.includes(id))
  return valid[index] ?? null
}

export function filterHotkeyActions(query: string): HotkeyAction[] {
  const normalized = query.trim().toLowerCase()
  return HOTKEY_ACTIONS.filter((action) => !normalized || `${action.id} ${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(normalized))
}
