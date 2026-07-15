import { useMemo, useState } from 'react'
import { Archive } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import type { TaskData } from '../../../stores/task.store'
import { useSessionStore } from '../../../stores/session.store'
import {
  TASK_TABS,
  filterOutCompleted,
  filterTasksByTab,
  sortTasksDesc,
  type TaskTimeTab,
} from './task-helpers'
import { TaskList } from './TaskList'

interface TaskPanelProps {
  tasks: TaskData[]
  agents: AgentData[]
  modes: Array<{ id: string; name: string }>
  currentSessionTaskId: string | null
  onSelectSession: (agentId: string, sessionId: string) => void
  projectId?: string
  onOpenTask: (taskId: string) => void
  onOpenReportModal: (taskId: string) => void
  renderReportModal: () => React.ReactNode
  markCompleteError: string | null
}

export function TaskPanel({
  tasks,
  agents,
  modes,
  currentSessionTaskId,
  onSelectSession,
  projectId,
  onOpenTask,
  onOpenReportModal,
  renderReportModal,
  markCompleteError,
}: TaskPanelProps) {
  void modes
  void projectId
  const [tab, setTab] = useState<TaskTimeTab>('today')
  const [hideCompleted, setHideCompleted] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const visibleTasks = useMemo(() => {
    const byTab = filterTasksByTab(tasks, tab)
    const afterHide = hideCompleted ? filterOutCompleted(byTab) : byTab
    return sortTasksDesc(afterHide)
  }, [tasks, tab, hideCompleted])

  const activeTab = TASK_TABS.find((t) => t.key === tab) ?? TASK_TABS[0]

  const handleJumpToSession = async (task: TaskData) => {
    if (task.initiator_session_id && task.initiator_agent_id) {
      onSelectSession(task.initiator_agent_id, task.initiator_session_id)
      return
    }
    try {
      const sessions = await useSessionStore.getState().listSessionsByTask(task.id)
      if (sessions.length === 0) {
        setToast('该任务暂无会话')
        window.setTimeout(() => setToast(null), 2000)
        return
      }
      const first = sessions[0]
      onSelectSession(first.agent_id, first.id)
    } catch {
      setToast('该任务暂无会话')
      window.setTimeout(() => setToast(null), 2000)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {TASK_TABS.map((t) => {
            const count = filterTasksByTab(tasks, t.key).length
            const active = tab === t.key
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 16,
                  border: active ? '1px solid #165dff' : '1px solid var(--border)',
                  background: active ? '#e8f3ff' : 'var(--bg-1)',
                  color: active ? '#165dff' : 'var(--text-3)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={11} />
                {t.label}
                {count > 0 && (
                  <span
                    style={{
                      background: active ? '#165dff' : 'var(--bg-3)',
                      color: active ? 'white' : 'var(--text-2)',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 10,
                      minWidth: 16,
                      textAlign: 'center',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--text-2)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="勾选后隐藏已完成/已取消的任务,待确认任务不受影响"
        >
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          隐藏已完成
        </label>
      </div>
      {visibleTasks.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 12px', color: 'var(--text-3)' }}>
          <div style={{ textAlign: 'center' }}>
            <Archive size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
            <div style={{ fontSize: 14 }}>暂无{activeTab.label}任务</div>
          </div>
        </div>
      ) : (
        <TaskList
          tasks={visibleTasks}
          agents={agents}
          currentSessionTaskId={currentSessionTaskId}
          onOpenTask={onOpenTask}
          onOpenReportModal={onOpenReportModal}
          onJumpToSession={handleJumpToSession}
        />
      )}
      {renderReportModal()}
      {markCompleteError && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--red)',
          color: 'white',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          zIndex: 1300,
          boxShadow: 'var(--shadow-lg)',
        }}>
          {markCompleteError}
        </div>
      )}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            borderRadius: 8,
            background: 'var(--text-1)',
            color: 'var(--bg-0)',
            fontSize: 13,
            fontWeight: 500,
            zIndex: 2000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
