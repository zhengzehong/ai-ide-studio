import type { CSSProperties, ReactNode } from 'react'
import { Clock3, Loader2, Mail, Pin, PinOff, Share2 } from 'lucide-react'

interface WorkspaceSessionActionsProps {
  pinned: boolean
  canMarkUnread: boolean
  timelineOpen: boolean
  pendingAction: 'pin' | 'unread' | null
  onShare: () => void
  onTogglePin: () => void
  onMarkUnread: () => void
  onToggleTimeline: () => void
}

export function WorkspaceSessionActions({
  pinned,
  canMarkUnread,
  timelineOpen,
  pendingAction,
  onShare,
  onTogglePin,
  onMarkUnread,
  onToggleTimeline,
}: WorkspaceSessionActionsProps) {
  return (
    <div style={styles.group}>
      <ActionButton icon={<Share2 size={13} />} label="分享" title="分享会话" onClick={onShare} />
      <ActionButton
        icon={pendingAction === 'pin'
          ? <Loader2 size={13} style={styles.spin} />
          : pinned ? <PinOff size={13} /> : <Pin size={13} />}
        label={pinned ? '取消置顶' : '置顶'}
        onClick={onTogglePin}
        disabled={pendingAction !== null}
      />
      <ActionButton
        icon={pendingAction === 'unread'
          ? <Loader2 size={13} style={styles.spin} />
          : <Mail size={13} />}
        label="标记未读"
        onClick={onMarkUnread}
        disabled={!canMarkUnread || pendingAction !== null}
        title={canMarkUnread ? '标记未读' : '当前会话还没有消息'}
      />
      <ActionButton
        icon={<Clock3 size={13} />}
        label="时间线"
        onClick={onToggleTimeline}
        active={timelineOpen}
      />
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  title,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      style={{
        ...styles.button,
        borderColor: active ? '#93b4f5' : 'var(--border)',
        background: active ? '#eff6ff' : 'var(--bg-0)',
        color: active ? '#2563eb' : 'var(--text-2)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 28,
    padding: '5px 11px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    fontSize: 13,
    whiteSpace: 'nowrap',
    transition: 'all .15s',
  },
  spin: {
    animation: 'spin 1s linear infinite',
  },
}
