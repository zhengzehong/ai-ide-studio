import { useEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Loader2 } from 'lucide-react'
import type { TeamActivity } from './team-activity-view'

export function TeamActivityBar({ members, onLocate }: { members: TeamActivity[]; onLocate: (id: string) => void }): ReactElement | null {
  if (!members.length) return null
  return <div aria-label="团队成员动态" style={{ display: 'flex', gap: 8, padding: '8px 16px 0', flexShrink: 0, overflowX: 'auto' }}>
    {members.map(member => <button key={member.id} type="button" onClick={() => onLocate(member.messageId)} title={`定位 ${member.name} 的最新消息`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', padding: '5px 8px', fontSize: 12, cursor: 'pointer' }}>
      <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: 'var(--blue)', color: 'var(--bg-0)', textAlign: 'center', lineHeight: '18px' }}>{member.name.slice(0, 1)}</span>
      {member.running && <Loader2 size={12} aria-label="运行中" style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</span>
      {member.unread && <span title="本页尚未查看的新回复" style={{ color: 'var(--blue)', flexShrink: 0 }}>未读</span>}
    </button>)}
  </div>
}

export function TeamMessageVisibility({ messageId, completed, scrollRef, onSeen, children }: { messageId: string; completed: boolean; scrollRef: RefObject<HTMLDivElement | null>; onSeen: (id: string) => void; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node || !completed) return
    let visible = false
    const report = (): void => { if (visible && document.visibilityState === 'visible') onSeen(messageId) }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; report() }, { root: scrollRef.current })
    observer.observe(node)
    document.addEventListener('visibilitychange', report)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', report) }
  }, [completed, messageId, onSeen, scrollRef])
  return <div ref={ref}>{children}</div>
}
