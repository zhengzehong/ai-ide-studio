import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import type { TaskData } from '../../../stores/task.store'
import { agentColor, formatTime } from '../helpers'
import { taskStageColor, taskStageLabel } from './task-helpers'

interface DetailHeaderProps {
  task: TaskData
  agent: AgentData | undefined
  collab: boolean
  reportBadge: { label: string; color: string; bg: string } | null
  stepProgressText: string | null
  onBack: () => void
}

export function DetailHeader({ task, agent, collab, reportBadge, stepProgressText, onBack }: DetailHeaderProps) {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 6,
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
          }}
          title="返回任务列表"
        >
          <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        {agent ? (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              background: agentColor(agent),
              color: 'white',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {agent.name}
          </span>
        ) : collab ? (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              background: '#86909c',
              color: 'white',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            多 Agent
          </span>
        ) : (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--bg-3)',
              color: 'var(--text-3)',
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            未分派
          </span>
        )}
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            flex: 1,
            minWidth: 0,
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.title}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 28, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            color: 'white',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 10,
            background: taskStageColor(task.status),
          }}
        >
          {taskStageLabel(task.status)}
        </span>
        {reportBadge && (
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 8,
              background: reportBadge.bg,
              color: reportBadge.color,
              fontWeight: 500,
            }}
          >
            {reportBadge.label}
          </span>
        )}
        {stepProgressText && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{stepProgressText}</span>}
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{formatTime(task.created_at)}</span>
      </div>
    </div>
  )
}

export function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}
