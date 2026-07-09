import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import type { SessionData } from '../../../stores/session.store'
import { useTaskStore, type TaskData, type TaskEventData, type TaskStepData, type TaskStepDetailView } from '../../../stores/task.store'
import { agentColor, formatTime } from '../helpers'
import {
  AGENT_REPORT_STATUS_BADGE,
  TASK_REPORT_EVENT_TYPES,
  eventReportMd,
  isCollabTask,
  taskStageColor,
  taskStageLabel,
} from './task-helpers'
import { StepList } from './StepList'
import { DetailActions, EmptyReports, LatestReportCard } from './DetailActions'

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
  const [updating, setUpdating] = useState(false)

  const steps: TaskStepData[] = useMemo(() => task.steps ?? [], [task.steps])
  const collab = isCollabTask(steps)
  const agentMap = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents])
  const agent = task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : null

  useEffect(() => {
    let cancelled = false
    fetchTaskEvents(task.id).then((loaded) => { if (!cancelled) setEvents(loaded) })
    return () => { cancelled = true }
  }, [task.id, fetchTaskEvents])

  useEffect(() => {
    let cancelled = false
    if (!collab) return
    Promise.all(
      steps.map(async (s) => {
        try { return [s.id, await fetchStepDetail(task.id, s.id)] as const }
        catch { return [s.id, undefined] as const }
      }),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, TaskStepDetailView | undefined> = {}
      for (const [id, detail] of results) next[id] = detail
      setStepDetails(next)
    })
    return () => { cancelled = true }
  }, [task.id, collab, steps, fetchStepDetail])

  const reportsByStep: Record<string, TaskStepDetailView['reports']> = {}
  for (const step of steps) reportsByStep[step.id] = stepDetails[step.id]?.reports ?? []

  const sortedEvents = [...events].sort((a, b) => b.sequence - a.sequence)
  const reportEvents = sortedEvents.filter((ev) => TASK_REPORT_EVENT_TYPES.has(ev.type) && eventReportMd(ev))
  const isTerminal = task.status === 'completed' || task.status === 'cancelled'
  const isBacklog = task.status === 'draft' || (!task.assigned_agent_id && !collab)
  const isDraft = task.status === 'draft'
  const reportBadge = task.agent_report_status ? AGENT_REPORT_STATUS_BADGE[task.agent_report_status] ?? null : null

  const stepProgressText = collab
    ? `${steps.filter(s => s.status === 'done').length}/${steps.length} 步骤`
    : null

  const handleMarkComplete = async () => {
    setUpdating(true)
    try { await updateTask(task.id, 'completed', undefined, '人工验收通过') } finally { setUpdating(false) }
  }
  const handleStart = async () => {
    setUpdating(true)
    try { await startTask(task.id) } finally { setUpdating(false) }
  }
  const handleJumpToSession = () => {
    if (sessions.length === 0) return
    const target = sessions.length === 1 ? sessions[0] : sessions[sessions.length - 1]
    onJumpToSession(target.id, target.agent_id)
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
          <Section label="任务目标">
            <div style={{
              fontSize: 12,
              color: 'var(--text-2)',
              lineHeight: 1.5,
              background: 'var(--bg-1)',
              padding: '7px 9px',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {task.description}
            </div>
          </Section>
        )}
        {!collab && task.stage && (
          <Section label="最新进度">
            <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>→ {task.stage}</div>
          </Section>
        )}
        {collab && (
          <Section label={`协作步骤 (${steps.length})`}>
            <StepList steps={steps} agents={agents} reportsByStep={reportsByStep} />
          </Section>
        )}
        <Section label="最近汇报">
          {latestReportEvent ? (
            <LatestReportCard event={latestReportEvent} onClick={() => onOpenReportModal(task.id, latestReportEvent.id)} />
          ) : <EmptyReports />}
        </Section>
      </div>
      <DetailActions
        isCollab={collab}
        isTerminal={isTerminal}
        isDraft={isDraft}
        isBacklog={isBacklog}
        updating={updating}
        hasSessions={sessions.length > 0}
        onStart={handleStart}
        onMarkComplete={handleMarkComplete}
        onJumpToSession={handleJumpToSession}
      />
    </div>
  )
}

interface DetailHeaderProps {
  task: TaskData
  agent: AgentData | undefined
  collab: boolean
  reportBadge: { label: string; color: string; bg: string } | null
  stepProgressText: string | null
  onBack: () => void
}

function DetailHeader({ task, agent, collab, reportBadge, stepProgressText, onBack }: DetailHeaderProps) {
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      flexShrink: 0,
    }}>
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
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: agentColor(agent), color: 'white', fontWeight: 500, flexShrink: 0 }}>
            {agent.name}
          </span>
        ) : collab ? (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#86909c', color: 'white', fontWeight: 500, flexShrink: 0 }}>
            多 Agent
          </span>
        ) : (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-3)', color: 'var(--text-3)', fontWeight: 500, flexShrink: 0 }}>
            未分派
          </span>
        )}
        <div style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 28, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'white', fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: taskStageColor(task.status) }}>
          {taskStageLabel(task.status)}
        </span>
        {reportBadge && (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: reportBadge.bg, color: reportBadge.color, fontWeight: 500 }}>
            {reportBadge.label}
          </span>
        )}
        {stepProgressText && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{stepProgressText}</span>}
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{formatTime(task.created_at)}</span>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
