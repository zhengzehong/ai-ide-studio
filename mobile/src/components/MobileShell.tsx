import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Mail, MessageSquare, ListTodo, Pin, Settings } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useConnectionStore } from '../stores/connection.store'
import { usePinnedSessionStore } from '../stores/pinned-session.store'
import { useAppStore } from '../stores/app.store'
import { useMobileSecretaryStore } from '../stores/secretary.store'
import { totalSecretaryAttention } from '@desktop/stores/secretary-attention'

const tabs = [
  { path: '/secretary', label: '秘书', icon: Mail },
  { path: '/pinned', label: '置顶', icon: Pin },
  { path: '/', label: '会话', icon: MessageSquare },
  { path: '/tasks', label: '任务', icon: ListTodo },
  { path: '/settings', label: '设置', icon: Settings },
] as const

export default function MobileShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const connected = useConnectionStore((s) => s.connected)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const pinnedItems = usePinnedSessionStore((s) => s.items)
  const secretaryProjectId = useMobileSecretaryStore((s) => s.projectId)
  const secretaries = useMobileSecretaryStore((s) => s.secretaries)
  const loadSecretaries = useMobileSecretaryStore((s) => s.load)
  const setupSecretaryListeners = useMobileSecretaryStore((s) => s.setupListeners)
  const pinnedAttention = pinnedItems.some((item) => item.unread || item.activityState === 'running')
  const secretaryAttention = currentProjectId && secretaryProjectId === currentProjectId
    ? totalSecretaryAttention(secretaries)
    : 0

  useEffect(() => {
    if (currentProjectId) void loadSecretaries(currentProjectId)
  }, [currentProjectId, loadSecretaries])
  useEffect(() => setupSecretaryListeners(), [setupSecretaryListeners])

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <Outlet />
      </div>

      <div style={styles.tabBar}>
        {tabs.map((tab) => {
          const active = tab.path === '/secretary'
            ? location.pathname.startsWith('/secretary')
            : location.pathname === tab.path
          const Icon = tab.icon
          return (
            <button
              key={tab.path}
              style={{ ...styles.tab, color: active ? 'var(--primary)' : 'var(--text-muted)' }}
              onClick={() => navigate(tab.path)}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ position: 'relative', fontSize: 11, marginTop: 2 }}>
                {tab.label}
                {tab.path === '/secretary' && secretaryAttention > 0 && (
                  <span style={styles.secretaryBadge} aria-label={`${secretaryAttention} 条秘书提醒`}>{secretaryAttention > 9 ? '9+' : secretaryAttention}</span>
                )}
                {tab.path === '/pinned' && pinnedAttention && <span style={styles.pinnedBadge} />}
              </span>
            </button>
          )
        })}
        <div style={{ ...styles.dot, background: connected ? 'var(--success)' : 'var(--error)' }} />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  tabBar: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 'var(--tab-height)',
    background: 'var(--bg-card)',
    borderTop: '1px solid var(--border-light)',
    paddingBottom: 'var(--safe-bottom)',
    flexShrink: 0,
  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
    transition: 'color .2s',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: '3%',
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  pinnedBadge: {
    position: 'absolute',
    top: -2,
    right: -9,
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#fa5151',
  },
  secretaryBadge: {
    position: 'absolute',
    top: -8,
    right: -15,
    minWidth: 15,
    height: 15,
    padding: '0 3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    background: '#fa5151',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
  },
}
