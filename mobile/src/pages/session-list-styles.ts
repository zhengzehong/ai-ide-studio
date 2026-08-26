import type { CSSProperties } from 'react'

export const sessionListStyles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    width: '100%',
    background: '#ededed',
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
    background: '#ededed',
    transition: 'margin-left .3s cubic-bezier(0.32, 0.72, 0, 1)',
  },
  mainAreaPinned: { marginLeft: 60 },
  list: { flex: 1, overflowY: 'auto', background: '#ededed', padding: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%' },
  emptyText: { color: '#b2b2b2', fontSize: 14, marginTop: 12 },
}
