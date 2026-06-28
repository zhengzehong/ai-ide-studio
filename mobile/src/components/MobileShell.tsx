import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, ListTodo, Settings } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useConnectionStore } from '../stores/connection.store'

const tabs = [
  { path: '/', label: '会话', icon: MessageSquare },
  { path: '/tasks', label: '任务', icon: ListTodo },
  { path: '/settings', label: '设置', icon: Settings },
] as const

export default function MobileShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const connected = useConnectionStore((s) => s.connected)

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <Outlet />
      </div>

      <div style={styles.tabBar}>
        {tabs.map((tab) => {
          const active = location.pathname === tab.path
          const Icon = tab.icon
          return (
            <button
              key={tab.path}
              style={{ ...styles.tab, color: active ? 'var(--primary)' : 'var(--text-muted)' }}
              onClick={() => navigate(tab.path)}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ fontSize: 11, marginTop: 2 }}>{tab.label}</span>
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
    right: '14%',
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
}
