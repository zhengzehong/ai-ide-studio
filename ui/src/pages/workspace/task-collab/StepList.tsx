import { useState } from 'react'
import { ChevronRight, Check, Loader2, Trash2 } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import { useTaskStore, type TaskStepData, type TaskStepReport } from '../../../stores/task.store'
import {
  STEP_COLORS,
  agentBadgeStyle,
  computeParallelMarkers,
  formatStepTime,
  stepColor,
  stepTagStyle,
} from './step-helpers'

interface StepListProps {
  taskId: string
  steps: TaskStepData[]
  agents: AgentData[]
  reportsByStep: Record<string, TaskStepReport[] | undefined>
  onSelectStep?: (stepId: string) => void
  onStepMutated?: () => void
}

interface StepRowProps {
  step: TaskStepData
  index: number
  agent: AgentData | undefined
  reports: TaskStepReport[]
  onSelect?: () => void
  onDelete?: () => void
  deleting?: boolean
}

function StepRow({ step, index, agent, reports, onSelect, onDelete, deleting }: StepRowProps) {
  const tag = stepTagStyle(step.status)
  const color = stepColor(step.status)
  const latestReport = reports[0]
  const badge = agentBadgeStyle(agent)
  const isBlocked = step.status === 'blocked'
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 7,
        padding: '7px 0',
        borderBottom: '1px solid var(--border)',
        position: 'relative',
        cursor: onSelect ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: color,
          color: step.status === 'pending' ? '#86909c' : 'white',
          fontSize: 10,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {step.status === 'done' ? (
          <Check size={10} />
        ) : step.status === 'running' ? (
          <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          index + 1
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-1)',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {step.title}
          </div>
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 3,
              fontWeight: 500,
              flexShrink: 0,
              background: tag.bg,
              color: tag.color,
            }}
          >
            {tag.label}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: badge.bg,
              color: 'white',
              fontSize: 7,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {badge.text}
          </span>
          <span>{agent?.name ?? '未分派'}</span>
          {latestReport && (
            <>
              <span>·</span>
              <span>{formatStepTime(latestReport.time)}</span>
            </>
          )}
          {step.status === 'ready' && (
            <>
              <span>·</span>
              <span style={{ color: STEP_COLORS.ready }}>待 start 派发</span>
            </>
          )}
        </div>
        {step.currentStage && (
          <div
            style={{
              fontSize: 10,
              color: isBlocked ? STEP_COLORS.blocked : 'var(--text-2)',
              fontStyle: 'italic',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isBlocked ? '' : '里程碑:'}
            {step.currentStage}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginTop: 2 }}>
        {onDelete && (
          <button
            type="button"
            title="删除步骤"
            disabled={deleting}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
            style={{
              width: 24,
              height: 24,
              border: '1px solid transparent',
              borderRadius: 5,
              background: 'transparent',
              color: 'var(--text-3)',
              cursor: deleting ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
        {onSelect && <ChevronRight size={12} color="var(--text-3)" />}
      </div>
    </div>
  )
}

export function StepList({ taskId, steps, agents, reportsByStep, onSelectStep, onStepMutated }: StepListProps) {
  const removeStep = useTaskStore((s) => s.removeStep)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const markers = computeParallelMarkers(steps)
  const markerBeforeStep = new Map(markers.map((m) => [m.beforeStepId, m]))
  const handleDelete = async (stepId: string) => {
    if (!window.confirm('确定删除此步骤？任务会回到 draft。')) return
    setRemovingId(stepId)
    try {
      await removeStep(taskId, stepId)
      onStepMutated?.()
    } finally {
      setRemovingId((current) => (current === stepId ? null : current))
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((step, idx) => {
        const marker = markerBeforeStep.get(step.id)
        return (
          <div key={step.id}>
            {marker && (
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--text-3)',
                  background: 'var(--bg-2)',
                  padding: '1px 5px',
                  borderRadius: 3,
                  display: 'inline-block',
                  margin: '2px 0 2px 25px',
                }}
              >
                {marker.kind === 'parallel' ? '↕ 并行' : '↓ 汇合'}
              </div>
            )}
            <StepRow
              step={step}
              index={idx}
              agent={step.assignee ? agentMap.get(step.assignee) : undefined}
              reports={reportsByStep[step.id] ?? []}
              onSelect={onSelectStep ? () => onSelectStep(step.id) : undefined}
              onDelete={() => {
                void handleDelete(step.id)
              }}
              deleting={removingId === step.id}
            />
          </div>
        )
      })}
    </div>
  )
}
