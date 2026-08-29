import { Activity, Pin, RefreshCw } from 'lucide-react'
import type { WidgetAgentProjectActivityGroup, WidgetSessionActivityItem } from '../stores/widget.store'
import type { SessionDockItem } from '../stores/session-dock.store'
import './updates/updates-sidebar.css'

export interface WorkbenchSessionTarget {
  sessionId: string
  projectId: string | null
  title: string
}

interface UpdatesSidebarProps {
  activityGroups: WidgetAgentProjectActivityGroup[]
  pinnedItems: SessionDockItem[]
  loading: boolean
  error: string | null
  selectedSessionId: string | null
  onRefresh: () => void
  onSelect: (target: WorkbenchSessionTarget) => void
}

export function UpdatesSidebar({
  activityGroups,
  pinnedItems,
  loading,
  error,
  selectedSessionId,
  onRefresh,
  onSelect,
}: UpdatesSidebarProps) {
  const dynamicIds = new Set(activityGroups.flatMap((group) => group.sessions.map((session) => session.sessionId)))
  const fallbackPinned = pinnedItems.filter((item) => !dynamicIds.has(item.sessionId))
  return (
    <aside className="workbench-sidebar" aria-label="会话导航">
      <header className="workbench-sidebar-header">
        <div>
          <strong>会话动态</strong>
          <span>{dynamicIds.size > 0 ? `${dynamicIds.size} 个需要关注` : '运行中或未读会话'}</span>
        </div>
        <button type="button" className="workbench-icon-button" onClick={onRefresh} title="刷新" aria-label="刷新">
          <RefreshCw size={15} className={loading ? 'workbench-spin' : undefined} />
        </button>
      </header>
      {error && <button type="button" className="workbench-error" onClick={onRefresh}>{error}，点击重试</button>}
      <div className="workbench-sidebar-scroll">
        <section className="workbench-sidebar-section">
          <div className="workbench-section-label"><Activity size={13} /> 动态</div>
          {loading && activityGroups.length === 0 && <div className="workbench-sidebar-empty">正在同步动态...</div>}
          {!loading && activityGroups.length === 0 && <div className="workbench-sidebar-empty">暂无运行中或未读会话</div>}
          {activityGroups.map((group) => (
            <div key={group.groupId} className="workbench-activity-group">
              <div className="workbench-group-heading">
                <span className="workbench-project-dot" />
                <span>{group.projectName || '未归属项目'}</span>
                <small>{group.agentName}</small>
              </div>
              {group.sessions.map((session) => (
                <DynamicRow
                  key={session.sessionId}
                  session={session}
                  selected={selectedSessionId === session.sessionId}
                  pinned={pinnedItems.some((item) => item.sessionId === session.sessionId)}
                  onSelect={onSelect}
                  projectId={group.projectId}
                />
              ))}
            </div>
          ))}
        </section>
        <section className="workbench-sidebar-section workbench-pinned-section">
          <div className="workbench-section-label"><Pin size={13} /> 置顶 <span>{pinnedItems.length}</span></div>
          {pinnedItems.length === 0 && <div className="workbench-sidebar-empty">还没有置顶会话</div>}
          {fallbackPinned.map((item) => (
            <button
              type="button"
              key={item.sessionId}
              className={`workbench-session-row${selectedSessionId === item.sessionId ? ' is-selected' : ''}`}
              onClick={() => onSelect({ sessionId: item.sessionId, projectId: item.projectId, title: item.sessionTitle || '未命名会话' })}
            >
              <span className={`workbench-status-dot ${item.activityState === 'running' ? 'is-running' : item.unread ? 'is-unread' : ''}`} />
              <span className="workbench-session-copy">
                <strong>{item.sessionTitle || '未命名会话'}</strong>
                <small>{item.projectName} · {item.agentName}</small>
              </span>
              <Pin size={12} className="workbench-pin-mark" />
            </button>
          ))}
        </section>
      </div>
    </aside>
  )
}

function DynamicRow({
  session,
  projectId,
  selected,
  pinned,
  onSelect,
}: {
  session: WidgetSessionActivityItem
  projectId: string | null
  selected: boolean
  pinned: boolean
  onSelect: (target: WorkbenchSessionTarget) => void
}) {
  const title = session.sessionTitle || '未命名会话'
  return (
    <button
      type="button"
      className={`workbench-session-row${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect({ sessionId: session.sessionId, projectId, title })}
    >
      <span className={`workbench-status-dot ${session.running ? 'is-running' : 'is-unread'}`} />
      <span className="workbench-session-copy">
        <strong>{title}</strong>
        <small>{session.taskTitle || session.stage || '有新的会话活动'}</small>
      </span>
      {pinned && <Pin size={12} className="workbench-pin-mark" />}
    </button>
  )
}
