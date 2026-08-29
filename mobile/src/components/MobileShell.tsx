import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Lightbulb, MessageSquare, Settings } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useConnectionStore } from '../stores/connection.store'
import { useMobileActivityStore } from '../stores/activity.store'

// 灵感替换任务 tab;任务列表保留轻入口(灵感页右上角图标)
const tabs = [
  { path: '/activity', label: '动态', icon: Activity },
  { path: '/', label: '会话', icon: MessageSquare },
  { path: '/inspiration', label: '灵感', icon: Lightbulb },
  { path: '/settings', label: '设置', icon: Settings },
] as const

export default function MobileShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const connected = useConnectionStore((s) => s.connected)
  // 动态角标只数未读:运行中的不算,和会话页/动态列表的未读口径一致
  const unreadCount = useMobileActivityStore((state) => (
    state.groups.reduce((total, group) => total + group.sessions.filter((session) => session.unread).length, 0)
  ))
  // 灵感页自带停靠工具条(与 tab 栏融合),去掉 tab 栏上边框避免双线
  const hasDockedBar = location.pathname.startsWith('/inspiration')

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <Outlet />
      </div>

      <div style={{ ...styles.tabBar, ...(hasDockedBar ? styles.tabBarFused : {}) }}>
        {tabs.map((tab) => {
          const active = location.pathname === tab.path
          const Icon = tab.icon
          return (
            <button
              key={tab.path}
              className="pressable"
              style={{ ...styles.tab, color: active ? 'var(--primary)' : 'var(--text-muted)' }}
              onClick={() => navigate(tab.path)}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ position: 'relative', fontSize: 11, marginTop: 2 }}>
                {tab.label}
                {tab.path === '/activity' && unreadCount > 0 && (
                  <span style={styles.activityBadge} aria-label={`${unreadCount} 条未读`}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
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
  tabBarFused: {
    borderTop: 'none',
  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
    transition: 'color .2s, transform .12s ease, opacity .12s ease',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: '3%',
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  activityBadge: {
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
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
  },
}
