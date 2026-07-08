import { useState, type CSSProperties } from 'react'
import { Edit3, Pin, PinOff, Trash2 } from 'lucide-react'
import type { ProjectData } from '../../stores/project.store'
import { useProjectStore } from '../../stores/project.store'
import { usePinnedProjects } from '../../utils/project-meta'
import { resolveProjectColor, resolveProjectIcon } from '../../utils/project-meta'
import { ProjectContextMenu } from './ProjectContextMenu'
import { buildProjectContextMenuItems } from './projectContextMenuItems'

interface ProjectCardProps {
  project: ProjectData
  isCurrent: boolean
  onEdit: (project: ProjectData) => void
  onDelete: (project: ProjectData) => void
}

export function ProjectCard({ project, isCurrent, onEdit, onDelete }: ProjectCardProps) {
  const selectProject = useProjectStore((s) => s.selectProject)
  const { isPinned, togglePin } = usePinnedProjects()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const pinned = isPinned(project.id)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(project.work_dir)
    } catch {
      // ignore clipboard errors
    }
  }

  const visitCount = project.visit_count ?? 0
  const lastVisited = project.last_visited_at
    ? new Date(project.last_visited_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '未访问'

  return (
    <div
      className={`project-card${isCurrent ? ' current' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={() => selectProject(project.id)}
      style={{
        background: 'var(--bg-0)',
        border: `1px solid ${isCurrent ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: 14,
        cursor: 'pointer',
        position: 'relative',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.borderColor = 'rgba(37, 99, 235, 0.5)' }}
      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {isCurrent && (
        <div style={styles.currentTag}>当前</div>
      )}
      <div style={styles.cardHead}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 7,
            background: resolveProjectColor(project),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {resolveProjectIcon(project)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.name}>{project.name}</div>
          <div style={styles.desc}>{project.description || '(无描述)'}</div>
        </div>
        <div style={styles.actions}>
          <button
            type="button"
            title={pinned ? '取消固定' : '固定到 Tab 栏'}
            onClick={(e) => { e.stopPropagation(); togglePin(project.id) }}
            style={styles.iconBtn}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            type="button"
            title="编辑"
            onClick={(e) => { e.stopPropagation(); onEdit(project) }}
            style={styles.iconBtn}
          >
            <Edit3 size={14} />
          </button>
          <button
            type="button"
            title="删除"
            onClick={(e) => { e.stopPropagation(); onDelete(project) }}
            style={{ ...styles.iconBtn, color: 'var(--red)' }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div style={styles.pathBox} title={project.work_dir}>{project.work_dir}</div>
      <div style={styles.stats}>
        <span style={styles.stat}>访问 {visitCount} 次</span>
        {pinned && <span style={styles.stat}>· 📌 已固定</span>}
        <span style={styles.stat}>· 最近 {lastVisited}</span>
      </div>

      <ProjectContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={buildProjectContextMenuItems({
          isPinned: pinned,
          onTogglePin: () => togglePin(project.id),
          onCopyPath: handleCopyPath,
          onEdit: () => onEdit(project),
          onDelete: () => onDelete(project),
        })}
      />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  currentTag: {
    position: 'absolute',
    top: 10,
    right: 10,
    background: 'rgba(37, 99, 235, 0.1)',
    color: 'var(--blue)',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 10,
    fontWeight: 600,
  },
  cardHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  desc: {
    fontSize: 12,
    color: 'var(--text-3)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    gap: 2,
    opacity: 0,
    transition: 'opacity 0.15s',
  },
  iconBtn: {
    width: 26,
    height: 26,
    border: 'none',
    background: 'transparent',
    borderRadius: 5,
    cursor: 'pointer',
    color: 'var(--text-3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  pathBox: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: 'var(--text-2)',
    background: 'var(--bg-1)',
    padding: '3px 6px',
    borderRadius: 4,
    marginTop: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stats: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
    fontSize: 11,
    color: 'var(--text-3)',
  },
  stat: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
}
