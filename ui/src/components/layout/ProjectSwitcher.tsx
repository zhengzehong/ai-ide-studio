import { useState } from 'react'
import { ArrowRight, Check, ChevronDown, Pin, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useProjectNavigation } from '../../hooks/use-project-navigation'
import { useProjectStore, type ProjectData } from '../../stores/project.store'
import { useProjectSessionStatsStore } from '../../stores/project-session-stats.store'
import { useUnifiedProjectSessionStats } from '../../hooks/use-unified-project-session-stats'
import { resolveProjectColor, resolveProjectIcon, usePinnedProjects } from '../../utils/project-meta'
import { ProjectFormModal, type ProjectFormValue } from '../project/ProjectFormModal'
import { ProjectActivityBadges } from './ProjectActivityBadges'

export function ProjectSwitcher() {
  const [open, setOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const projects = useProjectStore((state) => state.projects)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const createProject = useProjectStore((state) => state.createProject)
  const statsByProjectId = useUnifiedProjectSessionStats()
  const refreshStatsIfStale = useProjectSessionStatsStore((state) => state.refreshIfStale)
  const togglePin = usePinnedProjects((state) => state.togglePin)
  const isPinned = usePinnedProjects((state) => state.isPinned)
  const { switchProject } = useProjectNavigation()
  const navigate = useNavigate()
  const current = projects.find((project) => project.id === currentProjectId)

  const handleToggle = (): void => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) void refreshStatsIfStale()
  }

  const handleSelect = (project: ProjectData): void => {
    switchProject(project.id)
    setOpen(false)
  }

  const handleFormSubmit = async (value: ProjectFormValue): Promise<void> => {
    const project = await createProject({
      name: value.name,
      workDir: value.workDir,
      description: value.description || undefined,
      color: value.color || undefined,
      icon: value.icon || undefined,
    })
    setFormOpen(false)
    setOpen(false)
    switchProject(project.id)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={handleToggle} className="project-switcher-btn" type="button">
        <span className="project-switcher-badge" style={{ background: resolveProjectColor(current ?? {}) }}>
          <span className="project-switcher-badge-emoji">{resolveProjectIcon(current ?? {})}</span>
        </span>
        <span className="project-switcher-name">{current ? current.name : '选择项目'}</span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--text-3)',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>
      {open && (
        <>
          <div className="project-switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="project-switcher-dropdown">
            <div className="project-switcher-header">切换项目</div>
            {projects.length === 0 && (
              <div style={{ padding: '12px 16px', color: 'var(--text-3)', fontSize: 15 }}>
                暂无项目，请创建
              </div>
            )}
            {projects.map((project) => (
              <button
                key={project.id}
                className={`project-switcher-item${project.id === currentProjectId ? ' active' : ''}`}
                onClick={() => handleSelect(project)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  togglePin(project.id)
                }}
                type="button"
                title="右键固定到 Tab 栏或取消固定"
              >
                <span
                  className="project-switcher-item-icon"
                  style={{ background: resolveProjectColor(project) }}
                >
                  {resolveProjectIcon(project)}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.name}
                </span>
                <ProjectActivityBadges stats={statsByProjectId[project.id]} />
                {isPinned(project.id) && (
                  <span className="project-switcher-item-pin" title="已固定"><Pin size={12} /></span>
                )}
                {project.id === currentProjectId && <Check size={14} color="var(--green)" />}
              </button>
            ))}
            <div className="project-switcher-divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px' }}>
              <button
                type="button"
                className="project-switcher-item create"
                onClick={() => setFormOpen(true)}
                style={{ flex: 1, textAlign: 'left' }}
              >
                <Plus size={14} color="var(--blue)" />
                <span style={{ color: 'var(--blue)' }}>新建项目</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  navigate('/projects')
                  setOpen(false)
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--blue)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 500,
                  padding: '6px 8px',
                }}
                title="前往项目管理"
              >
                管理全部 <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}
      <ProjectFormModal
        key={formOpen ? 'create:new' : 'closed'}
        open={formOpen}
        mode="create"
        initial={null}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />
    </div>
  )
}
