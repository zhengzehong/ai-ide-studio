import type { MouseEvent, ReactNode } from 'react'
import { sessionListButtonStyle, sessionListRowStyle, sessionListActionsStyle } from './session-list-row-styles'

export interface SessionListRowProps {
  sessionId: string
  active: boolean
  onSelect: () => void
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  leading?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

/** Shared row shell used by regular Agent sessions and team conversations. */
export function SessionListRow({ sessionId, active, onSelect, onContextMenu, onMouseEnter, onMouseLeave, leading, actions, children }: SessionListRowProps) {
  return (
    <div
      data-session-row={sessionId}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={sessionListRowStyle(active)}
    >
      {leading}
      <button type="button" data-session-id={sessionId} onClick={onSelect} style={sessionListButtonStyle}>
        {children}
      </button>
      {actions && <div style={sessionListActionsStyle}>{actions}</div>}
    </div>
  )
}
