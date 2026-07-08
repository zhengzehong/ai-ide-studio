import type { MouseEvent } from 'react'
import { GripVertical, Plus, Zap } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { SessionData } from '../../stores/session.store'
import type { SessionIndicatorStateMap } from '../../utils/session-indicators'
import { agentAvatar, agentColor, formatTime, sessionTitle } from './helpers'
import { prepareNestedOrderDragEvent } from './ordering'
import { sessionIndicator } from '../../utils/session-indicators'
import { ICON_MAP } from '../../components/agent-square/constants'

const orderGripStyle: React.CSSProperties = {
  width: 16,
  height: 20,
  borderRadius: 4,
  color: 'var(--text-3)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'grab',
  flexShrink: 0,
  opacity: 0.72,
}

export interface SessionBarDraggedItem {
  type: 'agent' | 'session'
  id: string
  agentId?: string
}

export interface SessionBarProps {
  agent: AgentData | null
  sessions: SessionData[]
  currentSessionId: string | null
  runningSessionIds: SessionIndicatorStateMap
  unreadSessionIds: SessionIndicatorStateMap
  orderingMode: boolean
  draggedOrderItem: SessionBarDraggedItem | null
  onSelectSession: (agentId: string, sessionId: string) => void
  onNewSession: (agentId: string) => void
  onContextMenu: (e: MouseEvent, sessionId: string, agentId: string) => void
  onReorder: (agentId: string, sessionIds: string[]) => void
  onSetDraggedOrderItem: (item: SessionBarDraggedItem | null) => void
  onDropSession: (agentId: string, targetSessionId: string) => void
}

export function SessionBar(props: SessionBarProps) {
  const {
    agent,
    sessions,
    currentSessionId,
    runningSessionIds,
    unreadSessionIds,
    orderingMode,
    draggedOrderItem,
    onSelectSession,
    onNewSession,
    onContextMenu,
    onSetDraggedOrderItem,
    onDropSession,
  } = props

  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 1,
          height: '100%',
          background:
            'linear-gradient(to bottom, transparent, var(--border) 10%, var(--border) 90%, transparent)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <header
        style={{
          padding: '12px 14px 12px 17px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          minWidth: 0,
          position: 'relative',
          background: 'var(--bg-1)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: 'var(--blue)',
          }}
        />
        {agent ? (
          <>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: agentColor(agent),
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 600,
                color: 'white',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <SessionBarAvatar agent={agent} size={18} />
            </span>
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-1)',
                minWidth: 0,
              }}
              title={agent.name}
            >
              {agent.name}
            </span>
            <button
              type="button"
              onClick={() => onNewSession(agent.id)}
              title="新建会话"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              <Plus size={14} />
            </button>
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>选择智能体</span>
        )}
      </header>

      {agent ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
          {sessions.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: 'var(--text-3)',
                fontSize: 13,
              }}
            >
              无会话,点 + 新建
            </div>
          ) : (
            sessions.map((s) => {
              const indicator = sessionIndicator(s, runningSessionIds, unreadSessionIds)
              return (
                <div
                  key={s.id}
                  onDragOver={(e) => {
                    if (!orderingMode) return
                    prepareNestedOrderDragEvent(e)
                  }}
                  onDrop={(e) => {
                    if (!orderingMode) return
                    prepareNestedOrderDragEvent(e)
                    onDropSession(agent.id, s.id)
                  }}
                  onContextMenu={(e) => {
                    if (orderingMode) return
                    e.preventDefault()
                    onContextMenu(e, s.id, agent.id)
                  }}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 12,
                    paddingRight: 8,
                    background: currentSessionId === s.id ? 'var(--blue-light)' : 'transparent',
                    borderRadius: 4,
                    opacity:
                      draggedOrderItem?.type === 'session' && draggedOrderItem.id === s.id ? 0.55 : 1,
                    transition: 'background 0.15s',
                    boxShadow: currentSessionId === s.id ? 'inset 2px 0 0 var(--blue)' : 'none',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!orderingMode) onSelectSession(agent.id, s.id)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flex: 1,
                      minWidth: 0,
                      padding: '6px 0',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-1)',
                      cursor: orderingMode ? 'default' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {orderingMode && (
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation()
                          onSetDraggedOrderItem({ type: 'session', id: s.id, agentId: agent.id })
                        }}
                        onDragEnd={(e) => {
                          e.stopPropagation()
                          onSetDraggedOrderItem(null)
                        }}
                        style={orderGripStyle}
                        title="拖拽排序"
                      >
                        <GripVertical size={13} />
                      </span>
                    )}
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: indicator.color,
                        flexShrink: 0,
                        animation: indicator.pulse
                          ? 'session-running-pulse 1s ease-in-out infinite'
                          : undefined,
                        boxShadow: indicator.pulse
                          ? '0 0 0 4px rgba(5, 150, 105, 0.12)'
                          : undefined,
                      }}
                      title={indicator.title}
                    />
                    {s.is_primary ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          color: 'var(--blue)',
                          fontSize: 13,
                          flexShrink: 0,
                        }}
                        title="主会话"
                      >
                        <Zap size={12} fill="var(--blue)" />
                      </span>
                    ) : null}
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: s.is_primary ? 600 : 400,
                        minWidth: 0,
                      }}
                      title={sessionTitle(s)}
                    >
                      {sessionTitle(s)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-3)',
                        flexShrink: 0,
                        marginLeft: 4,
                      }}
                    >
                      {formatTime(s.last_message_at || s.updated_at || s.started_at)}
                    </span>
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </aside>
  )
}

function SessionBarAvatar({ agent, size }: { agent: AgentData; size: number }) {
  const result = agentAvatar(agent)
  if (result.kind === 'image') {
    return (
      <img
        src={result.src}
        alt={agent.name}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
      />
    )
  }
  if (result.kind === 'icon') {
    const IconComp = ICON_MAP[result.name]
    if (IconComp) {
      return <IconComp size={Math.floor(size * 0.6)} color="white" />
    }
  }
  return <>{result.text}</>
}
