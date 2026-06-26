import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bot,
  Check,
  ChevronDown,
  Clock,
  FolderKanban,
  Inbox,
  Library,
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
import { GlobalAssistantRail } from '../global-assistant/GlobalAssistantRail';
import {
  MAX_PINNED,
  PROJECT_COLORS,
  PROJECT_ICONS,
  autoColor,
  autoIcon,
  resolveProjectColor,
  resolveProjectIcon,
  usePinnedProjects,
} from '../../utils/project-meta';
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
  { to: '/events', icon: Inbox, label: '事件' },
  { to: '/knowledge', icon: Library, label: '知识库' },
];

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const createProject = useProjectStore((s) => s.createProject);
  const togglePin = usePinnedProjects((s) => s.togglePin);
  const isPinned = usePinnedProjects((s) => s.isPinned);

  const current = projects.find((p) => p.id === currentProjectId);

  const handleSelect = (p: ProjectData) => {
    selectProject(p.id);
    setOpen(false);
  };

  const handleContextPin = (id: string) => {
    togglePin(id);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get('name') as string;
    const workDir = form.get('workDir') as string;
    if (!name || !workDir) return;
    await createProject({
      name,
      workDir,
      description: form.get('description') as string || undefined,
      color: form.get('color') as string || undefined,
      icon: form.get('icon') as string || undefined,
    });
    setShowCreate(false);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="project-switcher-btn" type="button">
        <span
          className="project-switcher-badge"
          style={{ background: resolveProjectColor(current ?? {}) }}
        >
          <span className="project-switcher-badge-emoji">{resolveProjectIcon(current ?? {})}</span>
        </span>
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
              <div style={{ padding: '12px 16px', color: 'var(--text-3)', fontSize: 15 }}>
                暂无项目，请创建
              </div>
            )}
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-switcher-item${p.id === currentProjectId ? ' active' : ''}`}
                onClick={() => handleSelect(p)}
                onContextMenu={(e) => { e.preventDefault(); handleContextPin(p.id); }}
                type="button"
                title="右键固定到 Tab 栏 / 取消固定"
              >
                <span
                  className="project-switcher-item-icon"
                  style={{ background: resolveProjectColor(p) }}
                >
                  {resolveProjectIcon(p)}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                {isPinned(p.id) && <span className="project-switcher-item-pin" title="已固定">📌</span>}
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
                <input name="name" placeholder="项目名称" required className="command-input" style={{ fontSize: 15, padding: '4px 8px' }} />
                <input name="workDir" placeholder="工作目录路径 (如 D:\my-project)" required className="command-input" style={{ fontSize: 15, padding: '4px 8px' }} />
                <input name="description" placeholder="描述（可选）" className="command-input" style={{ fontSize: 15, padding: '4px 8px' }} />
                <ProjectMetaPicker defaultName="" />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowCreate(false)} style={{ fontSize: 14, padding: '3px 8px', background: 'var(--bg-3)', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                    取消
                  </button>
                  <button type="submit" style={{ fontSize: 14, padding: '3px 8px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
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

function ProjectTabBar() {
  const projects = useProjectStore((s) => s.projects);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const previousProjectId = useProjectStore((s) => s.previousProjectId);
  const selectProject = useProjectStore((s) => s.selectProject);
  const { pinnedIds, togglePin, reorder } = usePinnedProjects();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const pinnedProjects = useMemo(
    () => pinnedIds.map((id) => projects.find((p) => p.id === id)).filter((p): p is ProjectData => Boolean(p)),
    [pinnedIds, projects],
  );
  const visibleTabs = pinnedProjects.slice(0, MAX_PINNED);
  const overflowTabs = pinnedProjects.slice(MAX_PINNED);
  const previousProject = previousProjectId
    ? projects.find((p) => p.id === previousProjectId)
    : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1;
        if (visibleTabs[idx]) {
          e.preventDefault();
          selectProject(visibleTabs[idx].id);
        }
      } else if (e.altKey && e.key === 'ArrowLeft') {
        if (previousProject) {
          e.preventDefault();
          selectProject(previousProject.id);
        }
      } else if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        window.alert('命令面板开发中');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleTabs, previousProject, selectProject]);

  if (visibleTabs.length === 0 && !previousProject) return null;

  return (
    <div className="project-tab-bar">
      {visibleTabs.map((p, idx) => {
        const isActive = p.id === currentProjectId;
        return (
          <div
            key={p.id}
            className={`project-tab${isActive ? ' active' : ''}`}
            draggable
            onDragStart={() => setDragIndex(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== idx) reorder(dragIndex, idx);
              setDragIndex(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              togglePin(p.id);
            }}
            onClick={() => selectProject(p.id)}
            title={`${p.name} (Ctrl/Cmd+${idx + 1}, 右键取消固定)`}
          >
            <span
              className="project-tab-icon"
              style={{ background: resolveProjectColor(p) }}
            >
              {resolveProjectIcon(p)}
            </span>
            <span className="project-tab-name">{p.name}</span>
            <button
              type="button"
              className="project-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                togglePin(p.id);
              }}
              title="取消固定"
            >
              ×
            </button>
          </div>
        );
      })}
      {overflowTabs.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="project-tab project-tab-overflow"
            onClick={() => setOverflowOpen((o) => !o)}
            title="更多固定项目"
          >
            更多 ▾
          </button>
          {overflowOpen && (
            <>
              <div className="project-switcher-backdrop" onClick={() => setOverflowOpen(false)} />
              <div className="project-tab-overflow-menu">
                {overflowTabs.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="project-switcher-item"
                    onClick={() => { selectProject(p.id); setOverflowOpen(false); }}
                  >
                    <span className="project-switcher-item-icon" style={{ background: resolveProjectColor(p) }}>
                      {resolveProjectIcon(p)}
                    </span>
                    <span style={{ flex: 1 }}>{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {previousProject && (
        <button
          type="button"
          className="project-tab-prev"
          onClick={() => selectProject(previousProject.id)}
          title={`上一个: ${previousProject.name} (Alt+←)`}
        >
          ← 上一个: {previousProject.name}
        </button>
      )}
    </div>
  );
}

function ProjectMetaPicker({ defaultName }: { defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState<string>('');
  const [icon, setIcon] = useState<string>('');

  const effectiveColor = color || autoColor(name);
  const effectiveIcon = icon || autoIcon(name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className="project-switcher-item-icon"
          style={{ background: effectiveColor, width: 22, height: 22, fontSize: 12 }}
        >
          {effectiveIcon}
        </span>
        <input
          name="icon-name-mirror"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="预览（按项目名自动生成）"
          className="command-input"
          style={{ flex: 1, fontSize: 12, padding: '3px 6px', color: 'var(--text-3)' }}
          readOnly
        />
      </div>
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="icon" value={icon} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(color === c ? '' : c)}
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: c,
              border: color === c ? '2px solid var(--text-1)' : '1px solid var(--border)',
              cursor: 'pointer',
              padding: 0,
            }}
            title={c}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PROJECT_ICONS.map((ic) => (
          <button
            key={ic}
            type="button"
            onClick={() => setIcon(icon === ic ? '' : ic)}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: icon === ic ? 'var(--bg-3)' : 'transparent',
              border: icon === ic ? '1px solid var(--blue)' : '1px solid transparent',
              cursor: 'pointer',
              padding: 0,
              fontSize: 13,
              lineHeight: 1,
            }}
            title={ic}
          >
            {ic}
          </button>
        ))}
      </div>
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
        <ProjectTabBar />
        <main className="content-area">
          <Outlet />
        </main>
      </div>
      <GlobalAssistantRail />
    </div>
  );
}
