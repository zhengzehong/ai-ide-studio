import { STEP_COLORS } from './step-helpers'
import type { TaskStepData } from '../../../stores/task.store'

interface StepProgressBarProps {
  steps: TaskStepData[]
}

export function StepProgressBar({ steps }: StepProgressBarProps) {
  if (steps.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-3)' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {steps.map((s) => (
          <div
            key={s.id}
            title={`${s.title} · ${s.status}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: STEP_COLORS[s.status as keyof typeof STEP_COLORS] ?? STEP_COLORS.pending,
            }}
          />
        ))}
      </div>
      <span>
        {steps.filter(s => s.status === 'done').length}/{steps.length}
      </span>
    </div>
  )
}
