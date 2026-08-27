import type { CSSProperties, ReactNode } from 'react'
import { Loader2, Mail, Pin, PinOff } from 'lucide-react'

interface SessionAttentionPanelProps {
  pinned: boolean
  canMarkUnread: boolean
  pendingAction: 'pin' | 'unread' | null
  onTogglePin: () => void
  onMarkUnread: () => void
}

export function SessionAttentionPanel({
  pinned,
  canMarkUnread,
  pendingAction,
  onTogglePin,
  onMarkUnread,
}: SessionAttentionPanelProps) {
  return (
    <div data-session-attention-panel="true" style={styles.panel}>
      <AttentionAction
        icon={pendingAction === 'pin'
          ? <Loader2 size={22} style={styles.spin} />
          : pinned ? <PinOff size={22} /> : <Pin size={22} />}
        label={pinned ? '取消置顶' : '置顶'}
        disabled={pendingAction !== null}
        onClick={onTogglePin}
      />
      <AttentionAction
        icon={pendingAction === 'unread'
          ? <Loader2 size={22} style={styles.spin} />
          : <Mail size={22} />}
        label="标记未读"
        disabled={!canMarkUnread || pendingAction !== null}
        onClick={onMarkUnread}
      />
    </div>
  )
}

function AttentionAction({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-session-attention-action={label}
      style={{ ...styles.action, opacity: disabled ? 0.42 : 1 }}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      <span style={styles.icon}>{icon}</span>
      <span style={styles.label}>{label}</span>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 24,
    marginTop: 8,
    padding: '14px 8px 6px',
    borderTop: '1px solid var(--border-light)',
  },
  action: {
    width: 72,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 7,
    padding: 0,
    background: 'transparent',
    color: 'var(--text-primary)',
  },
  icon: {
    width: 48,
    height: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
  },
  label: {
    fontSize: 12,
    lineHeight: 1.25,
    whiteSpace: 'nowrap',
  },
  spin: {
    animation: 'spin 1s linear infinite',
  },
}
