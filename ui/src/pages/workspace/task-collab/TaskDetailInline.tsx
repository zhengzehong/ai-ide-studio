import { useEffect, useMemo, useState } from 'react'
import type { AgentData } from '../../../stores/agent.store'
import type { SessionData } from '../../../stores/session.store'
import {
  useTaskStore,
  type TaskData,
  type TaskEventData,
  type TaskStepData,
  type TaskStepDetailView,
} from '../../../stores/task.store'
import {
  AGENT_REPORT_STATUS_BADGE,
  TASK_REPORT_EVENT_TYPES,
  eventReportMd,
  isCollabTask,
} from './task-helpers'
import { StepList } from './StepList'
import { DetailActions, EmptyReports, LatestReportCard } from './DetailActions'
import { StepModal } from './StepModal'
import { DetailHeader, DetailSection } from './task-detail-parts'

interface TaskDetailInlineProps {
  task: TaskData
  agents: AgentData[]
  modes: Array<{ id: string; name: string }>
  sessions: SessionData[]
  onBack: () => void
  onJumpToSession: (sessionId: string, agentId: string) => void
  onOpenReportModal: (taskId: string, initialEventId?: string | null) => void
}

export function TaskDetailInline({
  task,
  agents,
  modes,
  sessions,
  onBack,
  onJumpToSession,
  onOpenReportModal,
}: TaskDetailInlineProps) {
  void modes
  const fetchTaskEvents = useTaskStore((s) => s.fetchTaskEvents)
  const fetchStepDetail = useTaskStore((s) => s.fetchStepDetail)
  const updateTask = useTaskStore((s) => s.updateTask)
  const startTask = useTaskStore((s) => s.startTask)
  const [events, setEvents] = useState<TaskEventData[]>([])
  const [stepDetails, setStepDetails] = useState<Record<string, TaskStepDetailView | undefined>>({})
  const [editingStep, setEditingStep] = useState<TaskStepDetailView | null | undefined>(undefined)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  const steps: TaskStepData[] = useMemo(() => task.steps ?? [], [task.steps])
  const collab = isCollabTask(steps) || (task.status === 'draft' && !task.assigned_agent_id)
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const agent = task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : null

  useEffect(() => {
    let cancelled = false
    fetchTaskEvents(task.id).then((loaded) => {
      if (!cancelled) setEvents(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [task.id, fetchTaskEvents])

  useEffect(() => {
    let cancelled = false
    if (!collab) return
    Promise.all(
      steps.map(async (s) => {
        try {
          return [s.id, await fetchStepDetail(task.id, s.id)] as const
        } catch {
          return [s.id, undefined] as const
        }
      }),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, TaskStepDetailView | undefined> = {}
      for (const [id, detail] of results) next[id] = detail
      setStepDetails(next)
    })
    return () => {
      cancelled = true
    }
  }, [task.id, collab, steps, fetchStepDetail])

  const reportsByStep: Record<string, TaskStepDetailView['reports']> = {}
  for (const step of steps) reportsByStep[step.id] = stepDetails[step.id]?.reports ?? []

  const sortedEvents = [...events].sort((a, b) => b.sequence - a.sequence)
  const reportEvents = sortedEvents.filter((ev) => TASK_REPORT_EVENT_TYPES.has(ev.type) && eventReportMd(ev))
  const isTerminal = task.status === 'completed' || task.status === 'cancelled'
  const isBacklog = task.status === 'draft' || (!task.assigned_agent_id && !collab)
  const isDraft = task.status === 'draft'
  const reportBadge = task.agent_report_status ? (AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null) : null

  const stepProgressText = collab ? `${steps.filter((s) => s.status === 'done').length}/${steps.length} 步骤` : null

  const handleMarkComplete = async () => {
    setUpdating(true)
    try {
      await updateTask(task.id, 'completed', undefined, '人工验收通过')
    } finally {
      setUpdating(false)
    }
  }
  const handleCancel = async () => {
    setUpdating(true)
    try {
      await updateTask(task.id, 'cancelled', undefined, '人工中断')
    } finally {
      setUpdating(false)
    }
  }
  const handleStart = async () => {
    setUpdating(true)
    try {
      await startTask(task.id)
      setDraftNotice(null)
    } finally {
      setUpdating(false)
    }
  }
  const handleJumpToSession = () => {
    if (sessions.length === 0) return
    const target = sessions.length === 1 ? sessions[0] : sessions[sessions.length - 1]
    onJumpToSession(target.id, target.agent_id)
  }
  const handleAddStep = () => setEditingStep(null)
  const handleEditStep = async (stepId: string) => {
    const cached = stepDetails[stepId]
    if (cached) {
      setEditingStep(cached)
      return
    }
    const detail = await fetchStepDetail(task.id, stepId)
    setStepDetails((current) => ({ ...current, [stepId]: detail }))
    setEditingStep(detail)
  }
  const handleStepMutated = () => {
    setDraftNotice('任务已回 draft,改完点启动任务')
  }
  const handleStepSaved = () => {
    setEditingStep(undefined)
    handleStepMutated()
  }

  const latestReportEvent = reportEvents[0] ?? null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <DetailHeader
        task={task}
        agent={agent ?? undefined}
        collab={collab}
        reportBadge={reportBadge}
        stepProgressText={stepProgressText}
        onBack={onBack}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 80px' }}>
        {task.description && (
          <DetailSection label="任务目标">
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-2)',
                lineHeight: 1.5,
                background: 'var(--bg-1)',
                padding: '7px 9px',
                borderRadius: 4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {task.description}
            </div>
          </DetailSection>
        )}
        {!collab && task.stage && (
          <DetailSection label="最新进度">
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>→ {task.stage}</div>
          </DetailSection>
        )}
        {collab && (
          <DetailSection label={`协作步骤 (${steps.length})`}>
            {draftNotice && (
              <div
                style={{
                  fontSize: 12,
                  color: '#ff7d00',
                  background: '#fff7e6',
                  borderRadius: 4,
                  padding: '6px 8px',
                  marginBottom: 6,
                }}
              >
                {draftNotice}
              </div>
            )}
            {steps.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  background: 'var(--bg-1)',
                  borderRadius: 4,
                  padding: '16px 10px',
                  textAlign: 'center',
                }}
              >
                还没有步骤，点击下方“加步骤”开始编排。
              </div>
            ) : (
              <StepList
                taskId={task.id}
                steps={steps}
                agents={agents}
                reportsByStep={reportsByStep}
                onSelectStep={handleEditStep}
                onStepMutated={handleStepMutated}
              />
            )}
          </DetailSection>
        )}
        <DetailSection label="最近汇报">
          {latestReportEvent ? (
            <LatestReportCard
              event={latestReportEvent}
              onClick={() => onOpenReportModal(task.id, latestReportEvent.id)}
            />
          ) : (
            <EmptyReports />
          )}
        </DetailSection>
      </div>
      <DetailActions
        isCollab={collab}
        isTerminal={isTerminal}
        isDraft={isDraft}
        isBacklog={isBacklog}
        status={task.status}
        updating={updating}
        hasSessions={sessions.length > 0}
        onStart={handleStart}
        onMarkComplete={handleMarkComplete}
        onCancel={handleCancel}
        onJumpToSession={handleJumpToSession}
        onAddStep={collab ? handleAddStep : undefined}
      />
      {editingStep !== undefined && (
        <StepModal
          key={editingStep?.id ?? 'new'}
          taskId={task.id}
          steps={steps}
          agents={agents}
          step={editingStep}
          onClose={() => setEditingStep(undefined)}
          onSaved={handleStepSaved}
        />
      )}
    </div>
  )
}
