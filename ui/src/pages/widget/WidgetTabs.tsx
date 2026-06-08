import { useTaskStore } from '../../stores/task.store'
import { useWidgetStore } from '../../stores/widget.store'
import { styles } from './styles'
import type { WidgetTab } from './types'

interface WidgetTabsProps {
  activeTab: WidgetTab
  onTabChange: (tab: WidgetTab) => void
}

export function WidgetTabs({ activeTab, onTabChange }: WidgetTabsProps) {
  const sessionCount = useWidgetStore((s) => s.sessions.length)
  const tasks = useTaskStore((s) => s.tasks)
  const { pinnedProjectId } = useWidgetStore((s) => s.preferences)
  const taskCount = tasks.filter((task) =>
    (!pinnedProjectId || task.project_id === pinnedProjectId) &&
    task.status !== 'completed' &&
    task.status !== 'cancelled',
  ).length

  return (
    <div style={styles.tabs}>
      <TabButton active={activeTab === 'agents'} label="Agent" count={sessionCount} onClick={() => onTabChange('agents')} />
      <TabButton active={activeTab === 'tasks'} label="任务" count={taskCount} onClick={() => onTabChange('tasks')} />
    </div>
  )
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <div style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }} onClick={onClick}>
      {label}{count > 0 && <span style={{ ...styles.tabCnt, ...(active ? styles.tabCntActive : {}) }}>{count}</span>}
    </div>
  )
}
