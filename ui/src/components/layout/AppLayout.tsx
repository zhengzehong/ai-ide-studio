import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Bot,
  Check,
  ChevronDown,
  Clock,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Zap,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent.store';
import './AppLayout.css';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '概览', end: true },
  { to: '/workspace', icon: MessageSquare, label: '工作台' },
  { to: '/tasks', icon: FolderKanban, label: '任务' },
  { to: '/schedule', icon: Clock, label: '自动化' },
];

const PROJECTS = [
  { id: 'payflow', name: 'PayFlow — 支付网关', active: true },
  { id: 'user-service', name: 'UserService — 用户中心', active: false },
  { id: 'admin-panel', name: 'AdminPanel — 管理后台', active: false },
];

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const current = PROJECTS.find(p => p.active)!;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="project-switcher-btn"
        type="button"
      >
        <span className="project-switcher-dot" />
        <span className="project-switcher-name">{current.name}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-3)', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <>
          <div className="project-switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="project-switcher-dropdown">
            <div className="project-switcher-header">切换项目</div>
            {PROJECTS.map(p => (
              <button key={p.id} className={`project-switcher-item${p.active ? ' active' : ''}`} onClick={() => setOpen(false)} type="button">
                <span className="project-switcher-item-dot" style={{ background: p.active ? 'var(--green)' : 'var(--bg-4)' }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {p.active && <Check size={14} color="var(--green)" />}
              </button>
            ))}
            <div className="project-switcher-divider" />
            <button className="project-switcher-item create" onClick={() => setOpen(false)} type="button">
              <Plus size={14} color="var(--blue)" />
              <span style={{ color: 'var(--blue)' }}>新建项目</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AgentStatusBar() {
  const agents = useAgentStore(s => s.agents);
  const busyCount = agents.filter((a) => a.status === 'running').length;
  const idleCount = agents.filter((a) => a.status === 'idle').length;
  const standbyCount = agents.filter((a) => a.status === 'standby').length;

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
  );
}

export default function AppLayout() {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Zap size={22} />
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
              }
              title={label}
            >
              <Icon size={20} />
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main-area">
        <header className="top-bar">
          <div className="top-bar-left">
            <ProjectSwitcher />
          </div>

          <div className="command-input-wrapper">
            <Search size={14} className="command-input-icon" />
            <input
              type="text"
              className="command-input"
              placeholder="搜索任务、Agent 或输入指令..."
            />
          </div>

          <div className="top-bar-right">
            <AgentStatusBar />
          </div>
        </header>

        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
