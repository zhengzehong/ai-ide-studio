import { useMemo, useState } from 'react'
import { PanelTopOpen, RefreshCw } from 'lucide-react'
import { useWidgetStore, type WidgetSessionActivityItem } from '../../stores/widget.store'
import {
  getActivityFilterLabel,
  getNextActivityFilter,
  matchesActivityFilter,
  type ActivityFilter,
} from './activity-filter'
import { WidgetAgentProjectGroup } from './WidgetAgentProjectGroup'
import { electronApi } from './types'
import { openWidgetSession } from './widget-session-action'

export function WidgetAgentActivityPanel() {
  const api = electronApi
  const groups = useWidgetStore((state) => state.activityGroups)
  const loading = useWidgetStore((state) => state.activitiesLoading)
  const error = useWidgetStore((state) => state.activitiesError)
  const pinnedProjectId = useWidgetStore((state) => state.preferences.pinnedProjectId)
  const fetchActivities = useWidgetStore((state) => state.fetchActivities)
  const markSessionRead = useWidgetStore((state) => state.markSessionRead)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [navigationError, setNavigationError] = useState<string | null>(null)

  const visibleGroups = useMemo(() => groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => matchesActivityFilter(session, filter)),
    }))
    .filter((group) => group.sessions.length > 0), [filter, groups])
  const sessions = groups.flatMap((group) => group.sessions)
  const agentCount = new Set(groups.map((group) => group.agentId)).size
  const runningCount = sessions.filter((session) => session.running).length
  const unreadCount = sessions.filter((session) => session.unread).length

  const handleSessionClick = async (
    projectId: string | null,
    session: WidgetSessionActivityItem,
  ): Promise<void> => {
    setNavigationError(null)
    if (!api) {
      setNavigationError('请在桌面客户端中打开会话')
      return
    }
    setNavigationError(await openWidgetSession({
      sessionId: session.sessionId,
      projectId,
      unread: session.unread,
    }, api.openMain, markSessionRead))
  }

  return (
    <>
      {(error || navigationError) && (
        <div className="widget-inline-error" role="alert">
          <span>{navigationError || error}</span>
          {error && (
            <button className="widget-error-action" onClick={() => void fetchActivities(pinnedProjectId)} title="重新同步" aria-label="重新同步">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      )}

      <div className="widget-content">
        {loading && groups.length === 0 ? (
          <div className="widget-empty">正在同步活跃会话...</div>
        ) : visibleGroups.length === 0 ? (
          <div className="widget-empty">暂无符合条件的活跃或未读会话</div>
        ) : (
          <ol className="widget-agent-project-list">
            {visibleGroups.map((group) => (
              <WidgetAgentProjectGroup
                key={group.groupId}
                group={group}
                onSessionClick={(session) => void handleSessionClick(group.projectId, session)}
              />
            ))}
          </ol>
        )}
      </div>

      <footer className="widget-footer">
        <div className="widget-summary">
          <strong>{agentCount}</strong> 个 Agent
          <span>·</span><strong>{sessions.length}</strong> 个会话
          <span>·</span><strong>{runningCount}</strong> 执行中
          <span>·</span><strong>{unreadCount}</strong> 未读
        </div>
        <button
          className="widget-status-cycle"
          type="button"
          onClick={() => setFilter(getNextActivityFilter(filter))}
          title="切换会话状态"
          aria-label={`会话状态筛选：${getActivityFilterLabel(filter)}，点击切换`}
        >
          {getActivityFilterLabel(filter)}
        </button>
        {api && (
          <button className="widget-open-main" onClick={() => void api.openMain()} title="打开主窗口" aria-label="打开主窗口">
            <PanelTopOpen size={15} />
          </button>
        )}
      </footer>
    </>
  )
}
