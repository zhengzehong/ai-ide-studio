import { GripVertical, Loader2, X } from 'lucide-react'
import type { DragEvent } from 'react'
import type { SessionDockItem } from '../../stores/session-dock.store'
import { formatSessionDockTime, sessionDockTitle } from './session-dock-format'

interface SessionDockRowProps {
  item: SessionDockItem
  removing: boolean
  reordering: boolean
  onOpen: () => void
  onRemove: () => void
  onDragStart: (event: DragEvent<HTMLSpanElement>) => void
  onDragOver: (event: DragEvent<HTMLLIElement>) => void
  onDrop: (event: DragEvent<HTMLLIElement>) => void
}

export function SessionDockRow({
  item,
  removing,
  reordering,
  onOpen,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: SessionDockRowProps) {
  return (
    <li className="session-dock-row" onDragOver={onDragOver} onDrop={onDrop}>
      <span
        className="session-dock-grip"
        draggable={!removing && !reordering}
        onDragStart={onDragStart}
        title="拖动排序"
      >
        <GripVertical size={14} />
      </span>
      <button type="button" className="session-dock-row-main" onClick={onOpen}>
        <span
          className="session-dock-project-mark"
          style={{ background: item.projectColor || 'var(--blue-light)' }}
          aria-hidden="true"
        >
          {item.projectIcon || item.projectName.slice(0, 1)}
        </span>
        <span className="session-dock-row-content">
          <span className="session-dock-row-title">{sessionDockTitle(item.sessionTitle, item.sessionId)}</span>
          <span className="session-dock-row-meta">
            <span>{item.projectName}</span><span>·</span><span>{item.agentName}</span>
          </span>
          {item.stage && <span className="session-dock-row-stage">{item.stage}</span>}
        </span>
        <span className="session-dock-row-tail">
          <span className={`session-dock-state session-dock-state--${item.activityState === 'running' ? 'running' : item.unread ? 'unread' : 'idle'}`}>
            <span />{item.activityState === 'running' ? '运行中' : item.unread ? '未读' : '空闲'}
          </span>
          <time>{formatSessionDockTime(item.lastActivityAt)}</time>
        </span>
      </button>
      <button
        type="button"
        className="session-dock-remove"
        onClick={onRemove}
        disabled={removing}
        title="取消置顶"
        aria-label="取消置顶"
      >
        {removing ? <Loader2 size={14} className="session-dock-spin" /> : <X size={14} />}
      </button>
    </li>
  )
}
