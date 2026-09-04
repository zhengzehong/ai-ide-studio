import { useMemo, useState } from 'react'
import { ArrowLeft, MoreHorizontal, X } from 'lucide-react'
import { useProjectNavigation } from '../../hooks/use-project-navigation'
import { useProjectStore, type ProjectData } from '../../stores/project.store'
import { useUnifiedProjectSessionStats } from '../../hooks/use-unified-project-session-stats'
import {
  MAX_PINNED,
  resolveProjectColor,
  resolveProjectIcon,
  usePinnedProjects,
} from '../../utils/project-meta'
import { ProjectActivityBadges } from './ProjectActivityBadges'

export function ProjectTabBar() {
  const projects = useProjectStore((state) => state.projects)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const previousProjectId = useProjectStore((state) => state.previousProjectId)
  const statsByProjectId = useUnifiedProjectSessionStats()
  const { pinnedIds, togglePin, reorder } = usePinnedProjects()
  const { switchProject } = useProjectNavigation()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const pinnedProjects = useMemo(
    () => pinnedIds
      .map((id) => projects.find((project) => project.id === id))
      .filter((project): project is ProjectData => Boolean(project)),
    [pinnedIds, projects],
  )
  const visibleTabs = pinnedProjects.slice(0, MAX_PINNED)
  const overflowTabs = pinnedProjects.slice(MAX_PINNED)
  const previousProject = previousProjectId
    ? projects.find((project) => project.id === previousProjectId)
    : undefined

  if (visibleTabs.length === 0 && !previousProject) return null

  return (
    <div className="project-tab-bar">
      {visibleTabs.map((project, index) => (
        <div
          key={project.id}
          className={`project-tab${project.id === currentProjectId ? ' active' : ''}`}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragIndex !== null && dragIndex !== index) reorder(dragIndex, index)
            setDragIndex(null)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            togglePin(project.id)
          }}
          onClick={() => switchProject(project.id)}
          title={project.name}
        >
          <span className="project-tab-icon" style={{ background: resolveProjectColor(project) }}>
            {resolveProjectIcon(project)}
          </span>
          <span className="project-tab-name">{project.name}</span>
          <ProjectActivityBadges stats={statsByProjectId[project.id]} compact />
          <button
            type="button"
            className="project-tab-close"
            onClick={(event) => {
              event.stopPropagation()
              togglePin(project.id)
            }}
            title="取消固定"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {overflowTabs.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="project-tab project-tab-overflow"
            onClick={() => setOverflowOpen((open) => !open)}
            title="更多固定项目"
          >
            <MoreHorizontal size={15} />
          </button>
          {overflowOpen && (
            <>
              <div className="project-switcher-backdrop" onClick={() => setOverflowOpen(false)} />
              <div className="project-tab-overflow-menu">
                {overflowTabs.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="project-switcher-item"
                    onClick={() => {
                      switchProject(project.id)
                      setOverflowOpen(false)
                    }}
                  >
                    <span
                      className="project-switcher-item-icon"
                      style={{ background: resolveProjectColor(project) }}
                    >
                      {resolveProjectIcon(project)}
                    </span>
                    <span style={{ flex: 1 }}>{project.name}</span>
                    <ProjectActivityBadges stats={statsByProjectId[project.id]} />
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
          onClick={() => switchProject(previousProject.id)}
          title="上一个项目"
        >
          <ArrowLeft size={13} /> 上一个：{previousProject.name}
          <ProjectActivityBadges stats={statsByProjectId[previousProject.id]} compact />
        </button>
      )}
    </div>
  )
}
