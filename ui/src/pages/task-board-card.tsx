import type { AgentData } from '../stores/agent.store'
import type { TaskData } from '../stores/task.store'
import { agentColor } from './workspace/helpers'
import { AGENT_REPORT_STATUS_BADGE, taskStageColor, taskStageLabel } from './workspace/task-collab'

const SOURCE_META: Record<string, { bg: string; color: string; label: string }> = {
  human: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '手动' },
  agent: { bg: 'var(--green-light)', color: 'var(--green)', label: 'Agent' },
  schedule: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '定时' },
  event: { bg: 'var(--orange-light)', color: 'var(--orange)', label: '事件' },
}

interface TaskCardProps {
  task: TaskData
  agents: AgentData[]
  onOpen: () => void
}

export function TaskCard({ task, agents, onOpen }: TaskCardProps) {
  const source = SOURCE_META[task.source] ?? SOURCE_META.human
  const reportBadge = task.agent_report_status ? (AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null) : null
  const stepAssignees = new Set(
    (task.steps ?? []).map((step) => step.assignee).filter((id): id is string => Boolean(id)),
  )
  const assignedAgentId = task.assigned_agent_id ?? (stepAssignees.size === 1 ? [...stepAssignees][0] : null)
  const agent = assignedAgentId ? (agents.find((item) => item.id === assignedAgentId) ?? null) : null
  const agentLabel = agent?.name ?? ((task.steps?.length ?? 0) > 0 ? '多 Agent' : '未指派')

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        background: 'var(--bg-0)',
        border: getCardBorder(task.status),
        borderRadius: 8,
        padding: 14,
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--text-1)',
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.5,
          marginBottom: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 4,
            background: source.bg,
            color: source.color,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {source.label}
        </span>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 4,
            background: `${taskStageColor(task.status)}18`,
            color: taskStageColor(task.status),
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {taskStageLabel(task.status)}
        </span>
        {reportBadge && (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background: reportBadge.bg,
              color: reportBadge.color,
              fontWeight: 500,
              fontSize: 11,
            }}
          >
            {reportBadge.label}
          </span>
        )}
      </div>
      {task.stage && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-2)',
            marginBottom: 8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.stage}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: 12,
            color: agent ? 'white' : 'var(--text-3)',
            background: agent ? agentColor(agent) : 'transparent',
            borderRadius: 10,
            padding: agent ? '2px 8px' : 0,
            fontWeight: 600,
          }}
        >
          {agentLabel}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatRelative(task.created_at)}</span>
      </div>
    </button>
  )
}

function getCardBorder(status: string): string {
  return status === 'needs_input' ? '2px solid #d97706' : '1px solid var(--border)'
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    return `${Math.floor(hours / 24)}天前`
  } catch {
    return iso
  }
}
