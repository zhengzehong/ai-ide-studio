import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bot,
  Check,
  ChevronDown,
  Clock,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  Store,
  Wrench,
  Zap,
} from 'lucide-react';
import { useAgentStore } from '../../stores/agent.store';
import { useProjectStore, type ProjectData } from '../../stores/project.store';
import './AppLayout.css';

const globalNav = [
  { to: '/', icon: LayoutDashboard, label: '概览', end: true },
  { to: '/agents', icon: Store, label: 'Agent 广场' },
  { to: '/skills', icon: Sparkles, label: '技能中心' },
  { to: '/tools', icon: Wrench, label: '工具管理' },
];

const projectNav = [
  { to: '/workspace', icon: MessageSquare, label: '工作台' },
  { to: '/tasks', icon: FolderKanban, label: '任务' },
  { to: '/schedule', icon: Clock, label: '自动化' },
];

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const createProject = useProjectStore((s) => s.createProject);

  const current = projects.find((p) => p.id === currentProjectId);

  const handleSelect = (p: ProjectData) => {
    selectProject(p.id);
    setOpen(false);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const workDir = form.get('workDir') as string;
    if (!name || !workDir) return;
    await createProject(name, workDir, form.get('description') as string || undefined);
    setShowCreate(false);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="project-switcher-btn" type="button">
        <FolderOpen size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="project-switcher-name">
          {current ? current.name : '选择项目'}
        </span>
        <ChevronDown
          size={14}
          style={{ color: 'var(--text-3)', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && (
        <>
          <div className="project-switcher-backdrop" onClick={() => { setOpen(false); setShowCreate(false); }} />
          <div className="project-switcher-dropdown">
            <div className="project-switcher-header">切换项目</div>
            {projects.length === 0 && (
              <div style={{ padding: '12px 16px', color: 'var(--text-3)', fontSize: 13 }}>
                暂无项目，请创建
              </div>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-switcher-item${p.id === currentProjectId ? ' active' : ''}`}
                onClick={() => handleSelect(p)}
                type="button"
              >
                <span
                  className="project-switcher-item-dot"
                  style={{ background: p.id === currentProjectId ? 'var(--green)' : 'var(--bg-4)' }}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                {p.id === currentProjectId && <Check size={14} color="var(--green)" />}
              </button>
            ))}
            <div className="project-switcher-divider" />
            {!showCreate ? (
              <button className="project-switcher-item create" onClick={() => setShowCreate(true)} type="button">
                <Plus size={14} color="var(--blue)" />
                <span style={{ color: 'var(--blue)' }}>新建项目</span>
              </button>
            ) : (
              <form onSubmit={handleCreate} style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input name="name" placeholder="项目名称" required className="command-input" style={{ fontSize: 13, padding: '4px 8px' }} />
                <input name="workDir" placeholder="工作目录路径 (如 D:\my-project)" required className="command-input" style={{ fontSize: 13, padding: '4px 8px' }} />
                <input name="description" placeholder="描述（可选）" className="command-input" style={{ fontSize: 13, padding: '4px 8px' }} />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowCreate(false)} style={{ fontSize: 12, padding: '3px 8px', background: 'var(--bg-3)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    取消
                  </button>
                  <button type="submit" style={{ fontSize: 12, padding: '3px 8px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    创建
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AgentStatusBar() {
  const agents = useAgentStore((s) => s.agents);
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
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const navigate = useNavigate();

  const handleProjectNavClick = (_to: string, e: React.MouseEvent) => {
    if (!currentProjectId) {
      e.preventDefault();
      navigate('/');
    }
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Zap size={22} />
        </div>
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
              to={to}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' sidebar-link--active' : ''}${!currentProjectId ? ' sidebar-link--disabled' : ''}`
              }
              title={currentProjectId ? label : `${label}（请先选择项目）`}
              onClick={(e) => handleProjectNavClick(to, e)}
            >
              <Icon size={20} />
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink to="/settings" className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link--active' : ''}`} title="设置">
            <Settings size={20} />
          </NavLink>
        </div>
      </aside>

      <div className="main-area">
        <header className="top-bar">
          <div className="top-bar-left">
            <ProjectSwitcher />
          </div>
          <div className="command-input-wrapper">
            <Search size={14} className="command-input-icon" />
            <input type="text" className="command-input" placeholder="搜索任务、Agent 或输入指令..." />
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
