import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MobileSessionItem } from '../stores/session.store'
import SessionCard from './SessionCard'
import { ConversationKindTag } from './session-list/ConversationKindTag'
import { AgentAvatar, badgeStyles, groupStyles } from './session-list/list-kit'

const HEADER_LONG_PRESS_MS = 500
const HEADER_MOVE_CANCEL_PX = 10

interface Props {
  team?: boolean
  agentId: string
  agentName: string
  sessions: MobileSessionItem[]
  onLongPress: (session: MobileSessionItem) => void
  onHeaderLongPress?: () => void
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

export default function SessionGroup({ agentId, agentName, sessions, onLongPress, onHeaderLongPress, team }: Props) {
  const runningCount = sessions.filter((s) => s.activityState === 'running').length
  const unreadCount = sessions.filter((s) => s.unread).length
  const activeCount = sessions.length
  const hasActive = runningCount > 0 || unreadCount > 0

  const [collapsed, setCollapsed] = useState(!hasActive)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 分组头长按:触发后吞掉随后的 click,避免松手时顺带折叠/展开
  const suppressHeadClickRef = useRef(false)
  const headPressRef = useRef<{ x: number; y: number; timer: number } | null>(null)

  useEffect(() => {
    setCollapsed(!hasActive)
  }, [hasActive])

  useEffect(() => () => {
    if (headPressRef.current) window.clearTimeout(headPressRef.current.timer)
  }, [])

  const toggle = () => {
    if (suppressHeadClickRef.current) {
      suppressHeadClickRef.current = false
      return
    }
    setCollapsed((v) => !v)
  }

  const clearHeadPress = () => {
    const press = headPressRef.current
    if (press) {
      window.clearTimeout(press.timer)
      headPressRef.current = null
    }
  }

  const fireHeaderLongPress = () => {
    headPressRef.current = null
    if (!onHeaderLongPress) return
    suppressHeadClickRef.current = true
    try {
      navigator.vibrate?.(12)
    } catch {
      /* ignore */
    }
    onHeaderLongPress()
  }

  const handleHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!onHeaderLongPress) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    clearHeadPress()
    headPressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(fireHeaderLongPress, HEADER_LONG_PRESS_MS),
    }
  }

  const handleHeadPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = headPressRef.current
    if (!press) return
    if (Math.abs(event.clientX - press.x) > HEADER_MOVE_CANCEL_PX || Math.abs(event.clientY - press.y) > HEADER_MOVE_CANCEL_PX) {
      clearHeadPress()
    }
  }

  const sortedSessions = sortByUnreadAndTime(sessions)

  return (
    <div
      className="group-block"
      style={groupStyles.group}
      data-agent-id={agentId}
    >
      <div
        className="pressable"
        style={groupStyles.head}
        onClick={toggle}
        onPointerDown={handleHeadPointerDown}
        onPointerMove={handleHeadPointerMove}
        onPointerUp={clearHeadPress}
        onPointerLeave={clearHeadPress}
        onPointerCancel={clearHeadPress}
        onContextMenu={(event) => {
          if (onHeaderLongPress) event.preventDefault()
        }}
      >
        <AgentAvatar agentId={agentId} name={agentName} />
        <div style={groupStyles.info}>
          <div style={groupStyles.name}>{agentName}<ConversationKindTag team={team} /></div>
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
