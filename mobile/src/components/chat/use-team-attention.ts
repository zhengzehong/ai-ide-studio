import { useEffect, useRef, useState } from 'react'
import type { ConversationAdapter } from '@desktop/components/chat/conversation-types'
import { usePinnedSessionStore } from '../../stores/pinned-session.store'
import { useConversationCatalog } from '../../stores/conversation-catalog.store'
import { showToast } from '../../utils/toast'

export function useTeamAttention(adapter: ConversationAdapter, leave: () => void): {
  open: boolean; setOpen: (value: boolean) => void; pending: 'pin' | 'unread' | null;
  pinned: boolean; togglePin: () => Promise<void>; markUnread: () => Promise<void>;
} {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<'pin' | 'unread' | null>(null)
  const pinned = usePinnedSessionStore(state => state.items.some(item => item.sessionId === adapter.sessionId))
  const loaded = usePinnedSessionStore(state => state.loaded)
  const mounted = useRef(true)
  const busy = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!loaded) void usePinnedSessionStore.getState().load({ silent: true }) }, [loaded])
  const execute = async (kind: 'pin' | 'unread', operation: () => Promise<void>): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setPending(kind)
    try { await operation(); if (mounted.current) setOpen(false) }
    catch (error) { if (mounted.current) showToast(error instanceof Error ? error.message : '操作失败') }
    finally { busy.current = false; if (mounted.current) setPending(null) }
  }
  return {
    open, setOpen, pending, pinned,
    togglePin: () => execute('pin', async () => {
      if (!adapter.sessionId) return
      const pins = usePinnedSessionStore.getState()
      const wasPinned = pins.isPinned(adapter.sessionId)
      await (wasPinned ? pins.remove(adapter.sessionId) : pins.add(adapter.sessionId))
      const current = usePinnedSessionStore.getState()
      if (current.isPinned(adapter.sessionId) === wasPinned) throw new Error(current.error || '置顶状态保存失败')
    }),
    markUnread: () => execute('unread', async () => {
      if (!adapter.markUnread) throw new Error('当前会话不支持标记未读')
      await adapter.markUnread()
      void useConversationCatalog.getState().load()
      if (mounted.current) leave()
    }),
  }
}
