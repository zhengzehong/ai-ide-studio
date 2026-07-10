import { Activity, CheckSquare, MessageSquare, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { EventCenterEventData } from '../../stores/event-center.store'
import type { ProjectData } from '../../stores/project.store'
import type { SessionData } from '../../stores/session.store'
import type { TaskData } from '../../stores/task.store'
import { EventDetailPanel } from '../event-center/EventDetailPanel'
import { SessionContext } from './dashboard-session-context'
import { ReportContextModal, TaskContext } from './dashboard-task-context'
import '../event-center/event-center.css'
import './dashboard-event-detail.css'

export type DashboardContext =
  | { kind: 'empty' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'event'; eventId: string }

interface Props {
  context: DashboardContext
  agents: AgentData[]
  sessions: SessionData[]
  tasks: TaskData[]
  events: EventCenterEventData[]
  projects: ProjectData[]
  projectId: string | null
  onChangeContext: (context: DashboardContext) => void
}

export function ContextPanel({
  context,
  agents,
  sessions,
  tasks,
  events,
  projects,
  projectId,
  onChangeContext,
}: Props) {
  const [reportModal, setReportModal] = useState<{ taskId: string; eventId: string | null } | null>(null)
  const title =
    context.kind === 'session'
      ? '会话上下文'
      : context.kind === 'task'
        ? '任务详情'
        : context.kind === 'event'
          ? '事件详情'
          : '上下文'

  return (
    <aside
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-0)',
        borderRadius: 'var(--radius-lg)',
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          height: 46,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <Activity size={15} color="var(--text-3)" />
        <strong style={{ flex: 1, fontSize: 15 }}>{title}</strong>
        {context.kind !== 'empty' && (
          <button
            type="button"
            onClick={() => onChangeContext({ kind: 'empty' })}
            title="关闭上下文"
            style={iconButtonStyle}
          >
            <X size={14} />
          </button>
        )}
      </header>
      {context.kind === 'session' && (
        <SessionContext
          session={sessions.find((session) => session.id === context.sessionId)}
          agents={agents}
          tasks={tasks}
          projects={projects}
        />
      )}
      {context.kind === 'task' && (
        <TaskContext
          task={tasks.find((task) => task.id === context.taskId)}
          agents={agents}
          sessions={sessions}
          onBack={() => onChangeContext({ kind: 'empty' })}
          onOpenSession={(sessionId) => onChangeContext({ kind: 'session', sessionId })}
          onOpenReportModal={(taskId, eventId) => setReportModal({ taskId, eventId: eventId ?? null })}
        />
      )}
      {context.kind === 'event' && (
        <div className="dashboard-event-detail" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <EventDetailPanel event={events.find((event) => event.id === context.eventId)} projectId={projectId} />
        </div>
      )}
      {context.kind === 'empty' && <EmptyContext />}
      {reportModal && (
        <ReportContextModal
          task={tasks.find((task) => task.id === reportModal.taskId)}
          initialEventId={reportModal.eventId}
          onClose={() => setReportModal(null)}
        />
      )}
    </aside>
  )
}

function EmptyContext() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
        color: 'var(--text-3)',
        textAlign: 'center',
      }}
    >
      <MessageSquare size={22} />
      <div style={{ fontSize: 14, lineHeight: 1.7 }}>选择会话、任务或事件后，详情会在这里展开。</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <CheckSquare size={14} />
        不离开全局看板即可处理上下文。
      </div>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-1)',
  color: 'var(--text-2)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}
