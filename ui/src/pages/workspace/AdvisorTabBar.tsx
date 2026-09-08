import { ListTodo, Settings2, Plus } from 'lucide-react'

export type AdvisorRightTab = 'tasks' | 'suggestions'

interface AdvisorTabBarProps {
  active: AdvisorRightTab
  pendingCount: number
  pulse: boolean
  onSelectTab: (tab: AdvisorRightTab) => void
  onOpenSettings: () => void
  onCreateTask: () => void
}

export function AdvisorTabBar({ active, pendingCount, pulse, onSelectTab, onOpenSettings, onCreateTask }: AdvisorTabBarProps): React.ReactElement {
  return (
    <div className="advisor-tabbar">
      <button
        type="button"
        className={`advisor-tab${active === 'tasks' ? ' advisor-tab-active' : ''}`}
        onClick={() => onSelectTab('tasks')}
      >
        <ListTodo size={14} /> 任务
      </button>
      <button
        type="button"
        className={`advisor-tab${active === 'suggestions' ? ' advisor-tab-active' : ''}`}
        onClick={() => onSelectTab('suggestions')}
      >
        建议
        {pendingCount > 0 && (
          <span className={`advisor-tab-badge${pulse ? ' advisor-tab-badge-pulse' : ''}`}>{pendingCount}</span>
        )}
      </button>
      <span className="advisor-tabbar-spacer" />
      {active === 'tasks' ? (
        <button type="button" className="advisor-tabbar-action advisor-tabbar-action-primary" onClick={onCreateTask}>
          <Plus size={12} /> 新建
        </button>
      ) : (
        <button type="button" className="advisor-tabbar-action" onClick={onOpenSettings} title="参谋设置">
          <Settings2 size={14} /> 参谋设置
        </button>
      )}
    </div>
  )
}
