import { useMemo, useState } from 'react'
import { PanelTopOpen, RefreshCw } from 'lucide-react'
import { useWidgetStore, type WidgetAgentActivityItem } from '../../stores/widget.store'
import { getActivityFilterLabel, getNextActivityFilter, type ActivityFilter } from './activity-filter'
import { electronApi } from './types'
import { openWidgetSession } from './widget-session-action'
import { WidgetAgentRow } from './WidgetAgentRow'

export function WidgetAgentActivityPanel() {
  const api = electronApi
  const activities = useWidgetStore((state) => state.activities)
  const loading = useWidgetStore((state) => state.activitiesLoading)
  const error = useWidgetStore((state) => state.activitiesError)
  const pinnedProjectId = useWidgetStore((state) => state.preferences.pinnedProjectId)
  const fetchActivities = useWidgetStore((state) => state.fetchActivities)
  const markSessionRead = useWidgetStore((state) => state.markSessionRead)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [navigationError, setNavigationError] = useState<string | null>(null)

  const visibleActivities = useMemo(
    () => activities.filter((activity) => filter === 'all' || activity.activityState === filter),
    [activities, filter],
  )
  const runningCount = activities.filter((activity) => activity.activityState === 'running').length
  const needsInputCount = activities.filter((activity) => activity.activityState === 'needs_input').length

  const handleActivityClick = async (activity: WidgetAgentActivityItem): Promise<void> => {
    setNavigationError(null)
    if (!api) {
      setNavigationError('请在桌面客户端中打开 Agent 会话')
      return
    }
    setNavigationError(await openWidgetSession(activity, api.openMain, markSessionRead))
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
        {loading && activities.length === 0 ? (
          <div className="widget-empty">正在同步 Agent 动态...</div>
        ) : visibleActivities.length === 0 ? (
          <div className="widget-empty">暂无符合条件的 Agent 动态</div>
        ) : (
          <ol className="widget-activity-list">
            {visibleActivities.map((activity) => (
              <WidgetAgentRow key={activity.agentId} activity={activity} onClick={() => void handleActivityClick(activity)} />
            ))}
          </ol>
        )}
      </div>

      <footer className="widget-footer">
        <div className="widget-summary">
          <strong>{activities.length}</strong> 个最近活跃
          <span>·</span><strong>{runningCount}</strong> 个运行中
          <span>·</span><strong>{needsInputCount}</strong> 个待处理
        </div>
        <button
          className="widget-status-cycle"
          type="button"
          onClick={() => setFilter(getNextActivityFilter(filter))}
          title="切换 Agent 状态"
          aria-label={`Agent 状态筛选：${getActivityFilterLabel(filter)}，点击切换`}
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
