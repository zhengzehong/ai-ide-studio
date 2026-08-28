import { type CSSProperties } from 'react'
import type { ProjectItem } from '../stores/app.store'

interface Props {
  project: ProjectItem | undefined
  onOpenDrawer: () => void
}

function resolveIcon(project: ProjectItem | undefined): string {
  if (!project) return '🌐'
  if (project.icon) return project.icon
  return '📦'
}

function resolveColor(project: ProjectItem | undefined): string {
  if (!project) return 'var(--primary)'
  if (project.color) return project.color
  return 'var(--primary)'
}

export default function ProjectSwitcher({ project, onOpenDrawer }: Props) {
  const name = project?.name ?? '全部项目'
  return (
    <button className="pressable" style={styles.pill} onClick={onOpenDrawer}>
      <span style={{ ...styles.emoji, background: resolveColor(project) }}>
        {resolveIcon(project)}
      </span>
      <span style={styles.name}>{name}</span>
      <span style={styles.arrow}>▾</span>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  pill: {
    flex: 1,
    height: 34,
    background: 'transparent',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    padding: '0 6px 0 4px',
    gap: 6,
    cursor: 'pointer',
    border: 'none',
    minWidth: 0,
    transition: 'transform .12s ease, opacity .12s ease, background .15s',
  },
  emoji: {
    width: 26,
    height: 26,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: '#fff',
    flexShrink: 0,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  arrow: {
    color: 'var(--text-muted)',
    fontSize: 12,
    flexShrink: 0,
  },
}
