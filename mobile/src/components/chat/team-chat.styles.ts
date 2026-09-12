import type { CSSProperties } from 'react'

// Keep this team-only layout aligned with ChatPage without coupling the pages.
export const teamChatStyles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
    paddingTop: 'calc(10px + var(--safe-top))', background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)', flexShrink: 0,
  },
  backBtn: {
    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
  },
  headerInfo: { flex: 1, minWidth: 0 },
  headerTitle: { display: 'block', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerSub: { display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 1 },
  runningDot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', flexShrink: 0, animation: 'pulse 1.5s infinite' },
  messages: { flex: 1, overflowY: 'auto', padding: '12px 0' },
  loadingWrap: { display: 'flex', justifyContent: 'center', padding: 20 },
  sendError: { padding: '7px 12px', background: 'var(--error-bg)', color: 'var(--error)', fontSize: 12, textAlign: 'center', borderTop: '1px solid var(--border-light)' },
  sender: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 },
}
