import { useEffect } from 'react'
import { subscribeHotkeyActions } from '../lib/hotkey-actions'

export function useHotkeys(actionIds: string | string[], handler: (actionId: string) => void): void {
  useEffect(() => {
    const accepted = new Set(Array.isArray(actionIds) ? actionIds : [actionIds])
    return subscribeHotkeyActions((actionId) => {
      if (accepted.has(actionId)) handler(actionId)
    })
  }, [actionIds, handler])
}
