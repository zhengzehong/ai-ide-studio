import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bot,
  Brain,
  Clock,
  FolderKanban,
  Inbox,
  Library,
  LayoutDashboard,
  Lightbulb,
  Mail,
  MessageSquare,
  Pin,
  Search,
  RadioTower,
  Settings,
  Share2,
  Sparkles,
  Store,
  Wrench,
  Zap,
} from 'lucide-react'
import { useProjectNavigation } from '../../hooks/use-project-navigation'
import { useAgentStore } from '../../stores/agent.store'
import { useProjectStore } from '../../stores/project.store'
import { GlobalAssistantRail } from '../global-assistant/GlobalAssistantRail'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ProjectTabBar } from './ProjectTabBar'
import { useSecretaryStore } from '../../stores/secretary.store'
import { totalSecretaryAttention } from '../../stores/secretary-attention'
import './AppLayout.css'

const globalNav = [
  { to: '/', icon: LayoutDashboard, label: '概览', end: true },
  { to: '/pinned', icon: Pin, label: '置顶会话' },
  { to: '/agents', icon: Store, label: 'Agent 广场' },
  { to: '/skills', icon: Sparkles, label: '技能中心' },
  { to: '/tools', icon: Wrench, label: '工具管理' },
]

const projectNav = [
  { to: '/workspace', icon: MessageSquare, label: '工作台' },
  { to: '/inspiration', icon: Lightbulb, label: '灵感' },
  { to: '/autonomy', icon: RadioTower, label: '自主工作' },
  { to: '/secretary', icon: Mail, label: '项目秘书' },
  { to: '/tasks', icon: FolderKanban, label: '任务' },
  { to: '/schedule', icon: Clock, label: '自动化' },
  { to: '/events', icon: Inbox, label: '事件' },
  { to: '/knowledge', icon: Library, label: '知识库' },
  { to: '/agent-memory', icon: Brain, label: 'Agent 记忆' },
]

function AgentStatusBar() {
  const agents = useAgentStore((state) => state.agents)
  const busyCount = agents.filter((agent) => agent.status === 'running').length
  const idleCount = agents.filter((agent) => agent.status === 'idle').length
  const standbyCount = agents.filter((agent) => agent.status === 'standby').length

  return (
    <div className="agent-status-bar">
      <Bot size={14} className="agent-status-icon" />
      <span className="status-dot status-busy" title="工作中" />
      <span className="status-count">{busyCount}</span>
      <span className="status-dot status-idle" title="空闲" />
      <span className="status-count">{idleCount}</span>
      <span className="status-dot status-standby" title="待机" />
      <span className="status-count">{standbyCount}</span>
    </div>
  )
}

export function AppLayout() {
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const secretaryProjectId = useSecretaryStore((state) => state.projectId)
  const secretaries = useSecretaryStore((state) => state.secretaries)
  const loadSecretaries = useSecretaryStore((state) => state.load)
  const setupSecretaryListeners = useSecretaryStore((state) => state.setupListeners)
  const { toProjectPath } = useProjectNavigation()
  const navigate = useNavigate()
  const secretaryAttention = currentProjectId && secretaryProjectId === currentProjectId
    ? totalSecretaryAttention(secretaries)
    : 0

  useEffect(() => {
    if (currentProjectId) void loadSecretaries(currentProjectId)
  }, [currentProjectId, loadSecretaries])
  useEffect(() => setupSecretaryListeners(), [setupSecretaryListeners])

  const handleProjectNavClick = (event: React.MouseEvent): void => {
    if (currentProjectId) return
    event.preventDefault()
    navigate('/')
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo"><Zap size={22} /></div>
        <nav className="sidebar-nav">
          {globalNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`}
              title={label}
            >
              <Icon size={20} />
            </NavLink>
          ))}
          <div className="sidebar-divider" />
          {projectNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={toProjectPath(to)}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' sidebar-link--active' : ''}${!currentProjectId ? ' sidebar-link--disabled' : ''}`
              }
              title={currentProjectId ? label : `${label}（请先选择项目）`}
              onClick={handleProjectNavClick}
            >
              <Icon size={20} />
              {to === '/secretary' && secretaryAttention > 0 && (
                <span className="sidebar-secretary-badge" aria-label={`${secretaryAttention} 条秘书提醒`}>
                  {secretaryAttention > 9 ? '9+' : secretaryAttention}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/shares" className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`} title="我的分享">
            <Share2 size={20} />
          </NavLink>
          <NavLink to="/templates" className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`} title="会话模板">
            <Sparkles size={20} />
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`} title="设置">
            <Settings size={20} />
          </NavLink>
        </div>
      </aside>
      <div className="main-area">
        <header className="top-bar">
          <div className="top-bar-left"><ProjectSwitcher /></div>
          <div className="command-input-wrapper">
            <Search size={14} className="command-input-icon" />
            <input type="text" className="command-input" placeholder="搜索任务、Agent 或输入指令..." />
          </div>
          <div className="top-bar-right"><AgentStatusBar /></div>
        </header>
        <ProjectTabBar />
        <main className="content-area"><Outlet /></main>
      </div>
      <GlobalAssistantRail />
    </div>
  )
}
