import type { CSSProperties } from 'react'

export const cardStyle: CSSProperties = {
  padding: 20,
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-0)',
  display: 'flex',
  flexDirection: 'column',
  transition: 'box-shadow 0.15s, border-color 0.15s',
}

export const iconBadge: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--blue-light)',
  color: 'var(--blue)',
  flexShrink: 0,
}

export const builtinBadge: CSSProperties = {
  fontSize: 13,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--bg-3)',
  color: 'var(--text-3)',
  fontWeight: 500,
}

export const customBadge: CSSProperties = {
  fontSize: 13,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--blue-light)',
  color: 'var(--blue)',
  fontWeight: 500,
}

export const skillTag: CSSProperties = {
  fontSize: 13,
  padding: '2px 8px',
  borderRadius: 8,
  background: 'var(--bg-2)',
  color: 'var(--text-3)',
  fontWeight: 500,
}

export const btnPrimary: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  fontSize: 15,
  fontWeight: 600,
  background: 'var(--blue)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
}

export const btnPrimarySmall: CSSProperties = {
  ...btnPrimary,
  padding: '6px 12px',
}

export const btnOutline: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  fontSize: 15,
  background: 'var(--bg-0)',
  color: 'var(--text-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
}

export const inputStyle: CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 14px 0 32px',
  fontSize: 15,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-0)',
  color: 'var(--text-1)',
  outline: 'none',
}

export const editorInput: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 15,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-0)',
  color: 'var(--text-1)',
  outline: 'none',
  boxSizing: 'border-box',
}

export const modalBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.3)',
  zIndex: 1000,
}

export const modalCard: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 520,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100vh - 48px)',
  overflow: 'auto',
  background: 'var(--bg-0)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-lg)',
  zIndex: 1001,
  padding: 22,
}

export const iconButton: CSSProperties = {
  border: 'none',
  background: 'var(--bg-2)',
  borderRadius: 6,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text-2)',
}
