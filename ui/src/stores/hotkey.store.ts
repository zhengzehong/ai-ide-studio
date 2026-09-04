import { create } from 'zustand'
import { applyBindingChange, type HotkeyOverrides } from '../lib/hotkey-registry'
import { HOTKEY_ACTIONS } from '../lib/hotkey-actions'
import { isValidBinding, normalizeBinding } from '../lib/platform-key'

const STORAGE_KEY = 'ai-ide.hotkey-overrides.v1'

function readOverrides(): HotkeyOverrides {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const validIds = new Set(HOTKEY_ACTIONS.map((action) => action.id))
    const source = 'overrides' in parsed && parsed.overrides && typeof parsed.overrides === 'object'
      ? parsed.overrides as Record<string, unknown>
      : parsed as Record<string, unknown>
    return Object.entries(source).reduce<HotkeyOverrides>((result, [id, value]) => {
      if (!validIds.has(id)) return result
      if (value === null) result[id] = null
      else if (typeof value === 'string' && isValidBinding(value)) result[id] = normalizeBinding(value)
      return result
    }, {})
  } catch {
    return {}
  }
}

function persist(overrides: HotkeyOverrides): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides)) } catch { /* storage is optional */ }
}

export interface HotkeyStore {
  overrides: HotkeyOverrides
  lastConflict: string[]
  setOverride: (actionId: string, binding: string | null) => { ok: boolean; conflicts: string[] }
  reset: (actionId: string) => void
  resetAll: () => void
}

export const useHotkeyStore = create<HotkeyStore>((set, get) => ({
  overrides: readOverrides(),
  lastConflict: [],
  setOverride: (actionId, binding) => {
    if (binding !== null && !isValidBinding(binding)) return { ok: false, conflicts: ['快捷键格式无效'] }
    const result = applyBindingChange(actionId, binding, get().overrides)
    if (result.unresolved.length > 0) {
      const conflicts = result.unresolved.map((item) => item.label)
      set({ lastConflict: conflicts })
      return { ok: false, conflicts }
    }
    persist(result.overrides)
    set({ overrides: result.overrides, lastConflict: result.conflicts.map((item) => item.label) })
    return { ok: true, conflicts: result.conflicts.map((item) => item.label) }
  },
  reset: (actionId) => {
    const next = { ...get().overrides }
    delete next[actionId]
    persist(next)
    set({ overrides: next, lastConflict: [] })
  },
  resetAll: () => {
    persist({})
    set({ overrides: {}, lastConflict: [] })
  },
}))

export { STORAGE_KEY as HOTKEY_STORAGE_KEY }
