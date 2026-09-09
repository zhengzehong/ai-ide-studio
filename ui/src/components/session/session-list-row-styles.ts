import type { CSSProperties } from 'react'

export const sessionListRowStyle = (active: boolean): CSSProperties => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 12,
  paddingRight: 8,
  background: active ? 'var(--blue-light)' : 'transparent',
  borderRadius: 4,
  transition: 'background 0.15s',
  boxShadow: active ? 'inset 2px 0 0 var(--blue)' : 'none',
})

export const sessionListButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  padding: '6px 0',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-1)',
  cursor: 'pointer',
  textAlign: 'left',
}

export const sessionListActionsStyle: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  paddingLeft: 4,
  background: 'var(--bg-0)',
  borderRadius: 4,
}
