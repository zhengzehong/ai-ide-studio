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
  if (!project) return '#07c160'
  if (project.color) return project.color
  return '#07c160'
}

export default function ProjectSwitcher({ project, onOpenDrawer }: Props) {
  const name = project?.name ?? '全部项目'
  return (
    <button style={styles.pill} onClick={onOpenDrawer}>
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
    transition: 'background .15s',
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
    color: '#191919',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  arrow: {
    color: '#b2b2b2',
    fontSize: 12,
    flexShrink: 0,
  },
}
