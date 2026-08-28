import type { CSSProperties } from 'react'

export const sessionListStyles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    width: '100%',
    background: 'var(--bg)',
    position: 'relative',
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity .3s',
    zIndex: 200,
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    minWidth: 0,
    background: 'var(--bg)',
    transition: 'margin-left .3s cubic-bezier(0.32, 0.72, 0, 1)',
  },
  mainAreaPinned: { marginLeft: 60 },
  list: { flex: 1, overflowY: 'auto', background: 'var(--bg)', padding: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%' },
  emptyText: { color: 'var(--text-muted)', fontSize: 14, marginTop: 12 },
}
