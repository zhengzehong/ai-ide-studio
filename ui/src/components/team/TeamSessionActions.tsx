import { Loader2, Mail, Pin, PinOff } from 'lucide-react'

interface TeamSessionActionsProps {
  /** 该线是否为当前团队的置顶会话（置顶复用全局会话坞，命中 master session 即视为已置顶）。 */
  pinned: boolean
  /** 线处于 active 才可置顶：归档线的置顶入口按拍板一并关闭（归档=不再参与团队运行）。 */
  canPin: boolean
  /** 线处于 active 且已有消息时才可标未读（服务端对空线会拒绝）。 */
  canMarkUnread: boolean
  pendingAction: 'pin' | 'unread' | null
  onTogglePin: () => void
  onMarkUnread: () => void
}

/**
 * 团队会话线右上角动作组（置顶/取消置顶、标记未读）。
 * 只放图标按钮，尺寸与激活态交给 `.conversation-actions` 既有样式（30×30，`is-active` 高亮）。
 */
export function TeamSessionActions({ pinned, canPin, canMarkUnread, pendingAction, onTogglePin, onMarkUnread }: TeamSessionActionsProps) {
  return (
    <>
      <button
        type="button"
        className={pinned && canPin ? 'is-active' : undefined}
        onClick={onTogglePin}
        disabled={!canPin || pendingAction !== null}
        title={canPin ? (pinned ? '取消置顶' : '置顶') : '已归档的会话线不可置顶'}
        aria-label={pinned ? '取消置顶' : '置顶'}
        style={!canPin || pendingAction !== null ? disabledStyle : undefined}
      >
        {pendingAction === 'pin' ? <Loader2 size={14} style={spinStyle} /> : pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button
        type="button"
        onClick={onMarkUnread}
        disabled={!canMarkUnread || pendingAction !== null}
        title={canMarkUnread ? '标记未读' : '当前会话线没有消息'}
        aria-label="标记未读"
        style={!canMarkUnread || pendingAction !== null ? disabledStyle : undefined}
      >
        {pendingAction === 'unread' ? <Loader2 size={14} style={spinStyle} /> : <Mail size={14} />}
      </button>
    </>
  )
}

const disabledStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' }
const spinStyle: React.CSSProperties = { animation: 'spin 1s linear infinite' }
