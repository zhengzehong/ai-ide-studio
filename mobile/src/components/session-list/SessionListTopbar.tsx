import type { CSSProperties } from 'react'
import { List, Pin, Plus, RefreshCw } from 'lucide-react'
import type { ProjectItem } from '../../stores/app.store'
import type { SessionViewMode } from '../../pages/session-view-mode'
import ProjectSwitcher from '../ProjectSwitcher'

interface Props {
  mode: SessionViewMode
  project: ProjectItem | undefined
  pinnedCount: number
  isDrawerPinned: boolean
  onOpenDrawer: () => void
  onNewSession: () => void
  onRefreshPinned: () => void
  onToggleMode: () => void
}

export function SessionListTopbar(props: Props) {
  if (props.mode === 'pinned') {
    return (
      <div style={styles.topbar}>
        <div style={styles.heading}>
          <strong style={styles.title}>置顶会话</strong>
          <span style={styles.subtitle}>{props.pinnedCount} 个会话，跨项目持续关注</span>
        </div>
        <button style={styles.iconButton} onClick={props.onRefreshPinned} aria-label="刷新置顶会话">
          <RefreshCw size={18} />
        </button>
        <button style={styles.iconButton} onClick={props.onToggleMode} aria-label="查看全部会话" title="查看全部会话">
          <List size={19} />
        </button>
      </div>
    )
  }

  return (
    <div style={styles.topbar}>
      {!props.isDrawerPinned && (
        <button style={styles.iconButton} onClick={props.onOpenDrawer} aria-label="打开项目抽屉">
          <MenuIcon />
        </button>
      )}
      <ProjectSwitcher project={props.project} onOpenDrawer={props.onOpenDrawer} />
      <button style={styles.iconButton} onClick={props.onNewSession} aria-label="新建会话">
        <Plus size={19} />
      </button>
      <button style={styles.iconButton} onClick={props.onToggleMode} aria-label="查看置顶会话" title="查看置顶会话">
        <Pin size={18} />
      </button>
    </div>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={20} height={20}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

const styles: Record<string, CSSProperties> = {
  topbar: { padding: '8px 12px', paddingTop: 'calc(8px + var(--safe-top))', height: 50, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-light)' },
  heading: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  title: { color: 'var(--text-primary)', fontSize: 16, fontWeight: 600 },
  subtitle: { marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 10 },
  iconButton: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 8, color: 'var(--text-secondary)' },
}
