import { useEffect, useRef, useState } from 'react'
import type { MobileSessionItem } from '../stores/session.store'
import SessionCard from './SessionCard'
import { AgentAvatar, badgeStyles, groupStyles } from './session-list/list-kit'

interface Props {
  agentId: string
  agentName: string
  sessions: MobileSessionItem[]
  onLongPress: (session: MobileSessionItem) => void
}

function sortByUnreadAndTime(sessions: MobileSessionItem[]): MobileSessionItem[] {
  const time = (s: MobileSessionItem) => {
    const t = s.lastMessageAt || s.updatedAt || s.startedAt
    return t ? Date.parse(t) || 0 : 0
  }
  return [...sessions].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1
    return time(b) - time(a)
  })
}

export default function SessionGroup({ agentId, agentName, sessions, onLongPress }: Props) {
  const runningCount = sessions.filter((s) => s.activityState === 'running').length
  const unreadCount = sessions.filter((s) => s.unread).length
  const activeCount = sessions.length
  const hasActive = runningCount > 0 || unreadCount > 0

  const [collapsed, setCollapsed] = useState(!hasActive)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setCollapsed(!hasActive)
  }, [hasActive])

  const toggle = () => setCollapsed((v) => !v)

  const sortedSessions = sortByUnreadAndTime(sessions)

  return (
    <div
      className="group-block"
      style={groupStyles.group}
      data-agent-id={agentId}
    >
      <div className="pressable" style={groupStyles.head} onClick={toggle}>
        <AgentAvatar agentId={agentId} name={agentName} />
        <div style={groupStyles.info}>
          <div style={groupStyles.name}>{agentName}</div>
          <div style={groupStyles.sub}>{activeCount} 活跃会话</div>
        </div>
        <div style={groupStyles.badgeRow}>
          {runningCount > 0 && (
            <span style={{ ...badgeStyles.pill, color: 'var(--success)', background: 'var(--success-bg)' }}>
              <span className="breathe" style={{ ...badgeStyles.dot, background: 'var(--success)' }} />
              {runningCount} 执行中
            </span>
          )}
          {unreadCount > 0 && (
            <span style={{ ...badgeStyles.pill, color: 'var(--primary)', background: 'var(--primary-bg)' }}>
              {unreadCount} 未读
            </span>
          )}
          {activeCount === 0 && runningCount === 0 && unreadCount === 0 && (
            <span style={groupStyles.idleText}>空闲</span>
          )}
        </div>
        <svg
          style={{ ...groupStyles.chevron, ...(collapsed ? groupStyles.chevronCollapsed : {}) }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <div
        ref={bodyRef}
        style={{ ...groupStyles.body, ...(collapsed ? groupStyles.bodyCollapsed : {}) }}
      >
        {sortedSessions.length === 0 ? (
          <div style={groupStyles.bodyEmpty}>暂无活跃会话</div>
        ) : (
          sortedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onLongPress={onLongPress}
            />
          ))
        )}
      </div>
    </div>
  )
}
