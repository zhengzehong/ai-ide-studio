import { FileText, ChevronRight } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import type { TaskData, TaskStepData } from '../../../stores/task.store'
import { agentColor, formatTime } from '../helpers'
import { AGENT_REPORT_STATUS_BADGE, TASK_TABS, isCollabTask, taskStageColor, taskStageLabel } from './task-helpers'
import { StepProgressBar } from './StepProgressBar'

interface TaskRowProps {
  task: TaskData
  agent: AgentData | undefined
  isCurrent: boolean
  onOpenTask: () => void
  onOpenReportModal: () => void
}

function TaskRow({ task, agent, isCurrent, onOpenTask, onOpenReportModal }: TaskRowProps) {
  const reportBadge = task.agent_report_status ? AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null : null
  const steps: TaskStepData[] = task.steps ?? []
  const collab = isCollabTask(steps)
  const hasStage = Boolean(task.stage)
  const reportBtn = (extraStyle?: React.CSSProperties) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenReportModal() }}
      title="查看汇报"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '2px 7px',
        borderRadius: 8,
        border: '1px solid #165dff',
        background: '#e8f3ff',
        color: '#165dff',
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        ...extraStyle,
      }}
    >
      <FileText size={11} />
      查看汇报
    </button>
  )
  return (
    <div
      onClick={onOpenTask}
      style={{
        padding: isCurrent ? '10px 12px 10px 10px' : '10px 12px',
        borderRadius: 8,
        border: isCurrent ? '1px solid #165dff' : '1px solid var(--border)',
        borderLeft: isCurrent ? '3px solid #165dff' : '1px solid var(--border)',
        background: isCurrent ? '#e8f3ff' : 'var(--bg-1)',
        marginBottom: 6,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {agent ? (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: agentColor(agent), color: 'white', fontWeight: 500, flexShrink: 0 }}>
            {agent.name}
          </span>
        ) : collab ? (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#86909c', color: 'white', fontWeight: 500, flexShrink: 0 }}>
            多 Agent
          </span>
        ) : (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: 'var(--bg-3)', color: 'var(--text-3)', fontWeight: 500, flexShrink: 0 }}>
            未分派
          </span>
        )}
        <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--text-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'white', fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: taskStageColor(task.status) }}>
          {taskStageLabel(task.status)}
        </span>
        {reportBadge && (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: reportBadge.bg, color: reportBadge.color, fontWeight: 500 }}>
            {reportBadge.label}
          </span>
        )}
        {collab && <StepProgressBar steps={steps} />}
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>
          {formatTime(task.created_at)}
        </span>
        {!hasStage && reportBtn()}
      </div>
      {hasStage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight size={11} style={{ transform: 'rotate(90deg)' }} />
            {task.stage}
          </span>
          {reportBtn({ flexShrink: 0 })}
        </div>
      )}
    </div>
  )
}

interface TaskListProps {
  tasks: TaskData[]
  agents: AgentData[]
  currentSessionTaskId: string | null
  onOpenTask: (taskId: string) => void
  onOpenReportModal: (taskId: string) => void
}

export function TaskList({ tasks, agents, currentSessionTaskId, onOpenTask, onOpenReportModal }: TaskListProps) {
  const agentMap = new Map(agents.map(a => [a.id, a]))
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px 12px' }}>
      {tasks.length === 0 ? null : (
        tasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            agent={task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : undefined}
            isCurrent={task.id === currentSessionTaskId}
            onOpenTask={() => onOpenTask(task.id)}
            onOpenReportModal={() => onOpenReportModal(task.id)}
          />
        ))
      )}
    </div>
  )
}

export { TASK_TABS }
