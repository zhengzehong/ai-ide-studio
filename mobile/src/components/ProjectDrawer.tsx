import { type CSSProperties, type RefObject } from 'react'
import type { ProjectItem } from '../stores/app.store'

interface ProjectDrawerProps {
  projects: ProjectItem[]
  currentProjectId: string | null
  isOpen: boolean
  isPinned: boolean
  onPickProject: (id: string) => void
  onTogglePin: () => void
  onCreateProject: () => void
  onManageProjects: () => void
  drawerRef: RefObject<HTMLDivElement | null>
  overlayRef: RefObject<HTMLDivElement | null>
  projectUnread: Record<string, number>
  totalSessions: Record<string, number>
}

function resolveColor(project: ProjectItem): string {
  if (project.color) return project.color
  return '#07c160'
}

function resolveIcon(project: ProjectItem): string {
  if (project.icon) return project.icon
  return '📦'
}

function formatMeta(project: ProjectItem, total: number): string {
  const parts: string[] = []
  parts.push(`${total} 会话`)
  if (project.last_visited_at) {
    const diff = Date.now() - Date.parse(project.last_visited_at)
    if (Number.isFinite(diff) && diff >= 0) {
      if (diff < 60_000) parts.push('刚刚')
      else if (diff < 3600_000) parts.push(`${Math.floor(diff / 60_000)} 分钟前`)
      else if (diff < 86400_000) parts.push(`${Math.floor(diff / 3600_000)} 小时前`)
      else parts.push(`${Math.floor(diff / 86400_000)} 天前`)
    }
  }
  return parts.join(' · ')
}

export default function ProjectDrawer({
  projects,
  currentProjectId,
  isOpen,
  isPinned,
  onPickProject,
  onTogglePin,
  onCreateProject,
  onManageProjects,
  drawerRef,
  overlayRef,
  projectUnread,
  totalSessions,
}: ProjectDrawerProps) {
  return (
    <>
      <div
        ref={overlayRef}
        style={{
          ...styles.overlay,
          ...(isOpen && !isPinned ? styles.overlayShow : {}),
          ...(isPinned ? { display: 'none' } : {}),
        }}
      />
      <div
        ref={drawerRef}
        style={{
          ...styles.drawer,
          ...((isOpen || isPinned) ? styles.drawerShow : {}),
          ...(isPinned ? styles.drawerPinned : {}),
        }}
      >
        <div style={{ ...styles.header, ...(isPinned ? styles.headerPinned : {}) }}>
          {!isPinned && (
            <div style={styles.headerLeft}>
              <div style={styles.headerTitle}>项目</div>
              <div style={styles.headerSub}>{projects.length} 个项目</div>
            </div>
          )}
          <button
            style={{ ...styles.pinBtn, ...(isPinned ? styles.pinBtnPinned : {}) }}
            onClick={onTogglePin}
            aria-label={isPinned ? '取消固定' : '固定为图标列'}
            title={isPinned ? '取消固定' : '固定为图标列'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={isPinned ? 18 : 16} height={isPinned ? 18 : 16}>
              <path d="M12 17v5" />
              <path d="M9 10.76V6h6v4.76a4 4 0 0 1 1.5 3.12V15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-.12A4 4 0 0 1 7.5 10.76z" />
            </svg>
          </button>
        </div>

        <div style={styles.list}>
          {projects.length === 0 && (
            <div style={styles.emptyHint}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.2 }}>📦</div>
              <div>暂无项目</div>
            </div>
          )}
          {projects.map((project) => {
            const unread = projectUnread[project.id] ?? 0
            const total = totalSessions[project.id] ?? 0
            const isActive = project.id === currentProjectId
            return (
              <div
                key={project.id}
                style={{
                  ...styles.item,
                  ...(isActive ? styles.itemActive : {}),
                  ...(isPinned ? styles.itemPinned : {}),
                }}
                onClick={() => onPickProject(project.id)}
              >
                <div style={{ ...styles.itemIcon, background: resolveColor(project) }}>
                  {resolveIcon(project)}
                </div>
                {!isPinned && (
                  <>
                    <div style={styles.itemInfo}>
                      <div style={styles.itemName}>{project.name}</div>
                      <div style={styles.itemMeta}>{formatMeta(project, total)}</div>
                    </div>
                    <div style={styles.itemBadges}>
                      {unread > 0 && <span style={styles.badgeUnread}>{unread}</span>}
                      {isActive && <span style={styles.itemCheck}>✓</span>}
                    </div>
                  </>
                )}
                {isPinned && unread > 0 && (
                  <span style={styles.pinBadge}>{unread > 99 ? '99+' : unread}</span>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ ...styles.footer, ...(isPinned ? styles.footerPinned : {}) }}>
          <div
            style={{ ...styles.footerItem, ...styles.footerItemNew, ...(isPinned ? styles.footerItemPinned : {}) }}
            onClick={onCreateProject}
          >
            <div style={{ ...styles.footerIcon, ...styles.footerIconNew }}>+</div>
            {!isPinned && <span style={styles.footerTextNew}>新建项目</span>}
          </div>
          <div
            style={{ ...styles.footerItem, ...(isPinned ? styles.footerItemPinned : {}) }}
            onClick={onManageProjects}
          >
            <div style={styles.footerIcon}>⚙</div>
            {!isPinned && <span>管理项目</span>}
          </div>
        </div>
      </div>
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity .3s',
    zIndex: 200,
  },
  overlayShow: {
    opacity: 1,
    pointerEvents: 'auto',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '80%',
    background: '#fff',
    transform: 'translateX(-100%)',
    transition: 'transform .3s cubic-bezier(0.32, 0.72, 0, 1), width .3s cubic-bezier(0.32, 0.72, 0, 1)',
    zIndex: 201,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 12px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  drawerShow: {
    transform: 'translateX(0)',
  },
  drawerPinned: {
    width: 60,
    boxShadow: 'none',
    borderRight: '0.5px solid #e0e0e0',
    zIndex: 5,
  },
  header: {
    padding: '50px 16px 12px',
    background: '#f7f7f7',
    borderBottom: '0.5px solid #e0e0e0',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    height: 96,
  },
  headerPinned: {
    padding: '50px 0 8px',
    justifyContent: 'center',
    borderBottom: '0.5px solid #f0f0f0',
  },
  headerLeft: {
    minWidth: 0,
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: '#191919',
    marginBottom: 2,
  },
  headerSub: {
    fontSize: 12,
    color: '#888',
  },
  pinBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    background: 'transparent',
    color: '#595959',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background .15s',
  },
  pinBtnPinned: {
    width: 40,
    height: 40,
    borderRadius: 8,
    background: '#07c160',
    color: '#fff',
    margin: '0 auto',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: 0,
    background: '#fff',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    cursor: 'pointer',
    transition: 'background .15s',
    position: 'relative',
    borderBottom: '0.5px solid #f5f5f5',
  },
  itemActive: {
    background: '#f5f5f5',
  },
  itemPinned: {
    justifyContent: 'center',
    padding: '10px 0',
    borderBottom: '0.5px solid #f5f5f5',
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: '#fff',
    flexShrink: 0,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 15,
    fontWeight: 500,
    color: '#191919',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: {
    fontSize: 12,
    color: '#b2b2b2',
    marginTop: 1,
  },
  itemBadges: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeUnread: {
    fontSize: 11,
    fontWeight: 500,
    padding: '1px 6px',
    borderRadius: 10,
    minWidth: 18,
    textAlign: 'center',
    color: '#fa5151',
    background: '#ffe8e8',
  },
  itemCheck: {
    color: '#07c160',
    fontSize: 16,
    fontWeight: 700,
  },
  pinBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 8,
    background: '#fa5151',
    color: '#fff',
    fontSize: 10,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid #fff',
    lineHeight: 1,
  },
  emptyHint: {
    padding: '40px 20px',
    textAlign: 'center',
    color: '#b2b2b2',
    fontSize: 13,
  },
  footer: {
    padding: 0,
    borderTop: '0.5px solid #e0e0e0',
    flexShrink: 0,
    background: '#fff',
  },
  footerPinned: {
    padding: 0,
  },
  footerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    cursor: 'pointer',
    color: '#595959',
    fontSize: 14,
    fontWeight: 400,
    borderBottom: '0.5px solid #f5f5f5',
  },
  footerItemPinned: {
    justifyContent: 'center',
    padding: '10px 0',
    gap: 0,
  },
  footerItemNew: {},
  footerIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: '#f5f5f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    flexShrink: 0,
  },
  footerIconNew: {
    background: '#e6f7ee',
    color: '#07c160',
  },
  footerTextNew: {
    color: '#07c160',
    fontWeight: 500,
  },
}
