import type { AgentData } from '../../stores/agent.store'
import type { SessionData } from '../../stores/session.store'
import type { TaskData } from '../../stores/task.store'
import { ReportHistoryModal, TaskDetailInline } from '../workspace/task-collab'

export function TaskContext({
  task,
  agents,
  sessions,
  onBack,
  onOpenSession,
  onOpenReportModal,
}: {
  task: TaskData | undefined
  agents: AgentData[]
  sessions: SessionData[]
  onBack: () => void
  onOpenSession: (sessionId: string) => void
  onOpenReportModal: (taskId: string, eventId?: string | null) => void
}) {
  if (!task) return <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 14 }}>未找到任务</div>
  const taskSessions = sessions.filter((session) => session.task_id === task.id || session.id === task.sessionId)
  return (
    <TaskDetailInline
      task={task}
      agents={agents}
      modes={[]}
      sessions={taskSessions}
      onBack={onBack}
      onJumpToSession={(sessionId) => onOpenSession(sessionId)}
      onOpenReportModal={onOpenReportModal}
    />
  )
}

export function ReportContextModal({
  task,
  initialEventId,
  onClose,
}: {
  task: TaskData | undefined
  initialEventId: string | null
  onClose: () => void
}) {
  if (!task) return null
  return <ReportHistoryModal task={task} initialEventId={initialEventId} onClose={onClose} />
}
