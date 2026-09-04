import { HOTKEY_ACTIONS, type HotkeyAction } from './hotkey-actions'
import { isValidBinding, normalizeBinding } from './platform-key'

export type HotkeyOverrides = Record<string, string | null>

export function effectiveBinding(action: HotkeyAction, overrides: HotkeyOverrides): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, action.id)) return overrides[action.id]
  return action.defaultKeys
}

export function actionBindings(overrides: HotkeyOverrides): Map<string, HotkeyAction[]> {
  const result = new Map<string, HotkeyAction[]>()
  for (const action of HOTKEY_ACTIONS) {
    const binding = effectiveBinding(action, overrides)
    if (!binding) continue
    const key = normalizeBinding(binding)
    const list = result.get(key) ?? []
    result.set(key, [...list, action])
  }
  return result
}

export function findConflicts(actionId: string, binding: string | null, overrides: HotkeyOverrides): HotkeyAction[] {
  if (!binding) return []
  const action = HOTKEY_ACTIONS.find((item) => item.id === actionId)
  if (!action || !isValidBinding(binding)) return []
  const normalized = normalizeBinding(binding)
  return HOTKEY_ACTIONS.filter((item) => item.id !== actionId && item.scope === action.scope)
    .filter((item) => effectiveBinding(item, overrides) && normalizeBinding(effectiveBinding(item, overrides) ?? '') === normalized)
}

export function applyBindingChange(
  actionId: string,
  binding: string | null,
  overrides: HotkeyOverrides,
): { overrides: HotkeyOverrides; conflicts: HotkeyAction[]; unresolved: HotkeyAction[] } {
  const action = HOTKEY_ACTIONS.find((item) => item.id === actionId)
  if (!action) return { overrides, conflicts: [], unresolved: [] }
  const normalized = binding === null ? null : normalizeBinding(binding)
  const conflicts = findConflicts(actionId, normalized, overrides)
  const next = { ...overrides, [actionId]: normalized }
  for (const conflict of conflicts) delete next[conflict.id]
  const unresolved = findConflicts(actionId, normalized, next)
  if (unresolved.length > 0) return { overrides, conflicts, unresolved }
  return { overrides: next, conflicts, unresolved: [] }
}

export function resolveHotkey(actionId: string, overrides: HotkeyOverrides): string | null {
  const action = HOTKEY_ACTIONS.find((item) => item.id === actionId)
  return action ? effectiveBinding(action, overrides) : null
}
