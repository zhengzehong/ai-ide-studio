import { useCallback, useEffect, useRef } from 'react'
import { wsClient } from '../../services/ws-client'
import type { Snapshot } from './team-chat-state'
import { TeamReadControl } from './team-read-control'

export function useTeamRead(conversationId: string | undefined, snapshots: Record<string, Snapshot>): () => Promise<void> {
  const control = useRef(new TeamReadControl())
  const latest = useRef(snapshots)
  useEffect(() => { latest.current = snapshots }, [snapshots])
  useEffect(() => {
    if (!conversationId) return
    const acknowledged = new Map<string, string>()
    let disposed = false
    let pending = false
    const markRead = async (): Promise<void> => {
      if (disposed || pending || document.visibilityState === 'hidden') return
      const messages = Object.entries(latest.current).flatMap(([sessionId, snapshot]) => {
        const message = snapshot.messages.filter(item => item.role === 'agent' && item.status !== 'running').at(-1)
        if (!message) return []
        const messageId = message.id.startsWith(`${sessionId}:`) ? message.id.slice(sessionId.length + 1) : message.id
        return acknowledged.get(sessionId) === messageId ? [] : [{ sessionId, messageId }]
      }).slice(0, 100)
      if (!messages.length) return
      pending = true
      try {
        await control.current.read(async () => {
          await wsClient.request({ type: 'team.conversation.markRead', conversationId, messages })
          if (!disposed) messages.forEach(ref => acknowledged.set(ref.sessionId, ref.messageId))
        })
      } catch { /* Retry while visible; a live completion may not yet be persisted. */ }
      finally { pending = false }
    }
    const timer = window.setInterval(() => { void markRead() }, 1500)
    const onVisible = (): void => { void markRead() }
    document.addEventListener('visibilitychange', onVisible)
    void markRead()
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [conversationId])
  return useCallback(async (): Promise<void> => {
    if (!conversationId) throw new Error('团队会话不存在')
    await control.current.markUnread(async () => {
      await wsClient.request({ type: 'team.conversation.markUnread', conversationId })
    })
  }, [conversationId])
}
