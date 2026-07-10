import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { MobileSessionItem } from '../stores/session.store'
import SessionCard from './SessionCard'

interface Props {
  agentId: string
  agentName: string
  sessions: MobileSessionItem[]
  onLongPress: (session: MobileSessionItem) => void
}

function agentInitials(name: string): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (/^[A-Za-z]/.test(trimmed)) {
    const parts = trimmed.split(/[\s-_/]+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return trimmed.slice(0, 2).toUpperCase()
  }
  return trimmed.slice(0, 2)
}

function agentColor(name: string): string {
  const palette = ['#576b95', '#10aeff', '#ffa340', '#07c160', '#6a7480', '#fa5151']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
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
      style={{ ...styles.group, ...(collapsed ? styles.groupCollapsed : {}) }}
      data-agent-id={agentId}
    >
      <div style={styles.head} onClick={toggle}>
        <svg
          style={{ ...styles.chevron, ...(collapsed ? styles.chevronCollapsed : {}) }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span style={{ ...styles.avatar, background: agentColor(agentName) }}>
          {agentInitials(agentName)}
        </span>
        <div style={styles.info}>
          <div style={styles.name}>{agentName}</div>
          <div style={styles.sub}>{activeCount} 活跃会话</div>
        </div>
        <div style={styles.badgeRow}>
          {runningCount > 0 && (
            <span style={styles.badgeRunning}>
              <span style={styles.dotRunning} />
              {runningCount}
            </span>
          )}
          {unreadCount > 0 && (
            <span style={styles.badgeUnread}>
              <span style={styles.dotUnread} />
              {unreadCount}
            </span>
          )}
          {activeCount === 0 && runningCount === 0 && unreadCount === 0 && (
            <span style={styles.countText}>空闲</span>
          )}
        </div>
      </div>
      <div
        ref={bodyRef}
        style={{ ...styles.body, ...(collapsed ? styles.bodyCollapsed : {}) }}
      >
        {sortedSessions.length === 0 ? (
          <div style={styles.bodyEmpty}>暂无活跃会话</div>
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

const styles: Record<string, CSSProperties> = {
  group: {
    background: '#fff',
    marginBottom: 8,
    overflow: 'hidden',
  },
  groupCollapsed: {},
  head: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 14px',
    gap: 10,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background .15s',
  },
  chevron: {
    width: 16,
    height: 16,
    transition: 'transform .25s ease',
    color: '#b2b2b2',
    flexShrink: 0,
  },
  chevronCollapsed: {
    transform: 'rotate(-90deg)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    color: '#fff',
    fontWeight: 500,
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: 500,
    color: '#191919',
  },
  sub: {
    fontSize: 12,
    color: '#b2b2b2',
    marginTop: 1,
  },
  badgeRow: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeRunning: {
    fontSize: 11,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 6px',
    borderRadius: 10,
    color: '#07c160',
    background: '#e6f7ee',
  },
  badgeUnread: {
    fontSize: 11,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 6px',
    borderRadius: 10,
    color: '#fa5151',
    background: '#ffe8e8',
  },
  dotRunning: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#07c160',
  },
  dotUnread: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#fa5151',
  },
  countText: {
    fontSize: 12,
    color: '#b2b2b2',
    fontWeight: 400,
  },
  body: {
    maxHeight: 2000,
    overflow: 'hidden',
    transition: 'max-height .3s ease',
  },
  bodyCollapsed: {
    maxHeight: 0,
  },
  bodyEmpty: {
    padding: 16,
    textAlign: 'center',
    color: '#b2b2b2',
    fontSize: 13,
  },
}
