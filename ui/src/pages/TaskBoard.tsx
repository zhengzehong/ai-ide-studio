import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useProjectNavigation } from '../hooks/use-project-navigation'
import { useProjectScopeId } from '../hooks/use-project-scope'
import { useAgentStore, type AgentData } from '../stores/agent.store'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectViewStateStore } from '../stores/project-view-state.store'
import { useSessionStore } from '../stores/session.store'
import { useTaskStore, type TaskData } from '../stores/task.store'
import { TaskCard } from './task-board-card'
import { CreateTaskModal, ReportHistoryModal, TaskDetailContainer } from './workspace/task-collab'

interface Column {
  id: string
  title: string
  color: string
  match: (status: string) => boolean
}

const COLUMNS: Column[] = [
  { id: 'draft', title: '待办', color: 'var(--text-3)', match: (status) => status === 'draft' },
  { id: 'running', title: '进行中', color: 'var(--blue)', match: (status) => status === 'running' },
  { id: 'needs_input', title: '需确认', color: '#d97706', match: (status) => status === 'needs_input' },
  {
    id: 'done',
    title: '已完成',
    color: 'var(--green)',
    match: (status) => status === 'completed' || status === 'cancelled',
  },
]

export function TaskBoard() {
  const navigate = useNavigate()
  const { toProjectPath } = useProjectNavigation()
  const currentProjectId = useProjectScopeId()
  const tasks = useTaskStore((s) => s.tasks)
  const fetchTasks = useTaskStore((s) => s.fetchTasks)
  const modes = useTaskStore((s) => s.modes)
  const updateTask = useTaskStore((s) => s.updateTask)
  const agents = useAgentStore((s) => s.agents)
  const connected = useConnectionStore((s) => s.connected)
  const sessions = useSessionStore((s) => s.sessions)
  const selectSession = useSessionStore((s) => s.selectSession)
  const [showNew, setShowNew] = useState(false)
  const selectedTaskId = useProjectViewStateStore((state) => (
    state.byProjectId[currentProjectId]?.tasks?.selectedTaskId ?? null
  ))
  const savedScrollLeft = useProjectViewStateStore((state) => (
    state.byProjectId[currentProjectId]?.tasks?.scrollLeft ?? 0
  ))
  const patchTasks = useProjectViewStateStore((state) => state.patchTasks)
  const setSelectedTaskId = useCallback((taskId: string | null): void => {
    patchTasks(currentProjectId, { selectedTaskId: taskId })
  }, [currentProjectId, patchTasks])
  const boardRef = useRef<HTMLDivElement | null>(null)
  const [reportModal, setReportModal] = useState<{ taskId: string; eventId: string | null } | null>(null)

  useLayoutEffect(() => {
    if (boardRef.current) boardRef.current.scrollLeft = savedScrollLeft
  }, [currentProjectId, savedScrollLeft])

  useEffect(() => {
    if (!connected) return
    void fetchTasks(currentProjectId, { force: true })
  }, [connected, currentProjectId, fetchTasks])

  const projectTasks = useMemo(
    () => (currentProjectId ? tasks.filter((task) => task.project_id === currentProjectId) : tasks),
    [currentProjectId, tasks],
  )
  const grouped = useMemo(() => {
    const map = new Map<string, TaskData[]>()
    for (const column of COLUMNS)
      map.set(
        column.id,
        projectTasks.filter((task) => column.match(task.status)),
      )
    return map
  }, [projectTasks])
  const selectedTask = selectedTaskId ? (projectTasks.find((task) => task.id === selectedTaskId) ?? null) : null
  const reportTask = reportModal ? (projectTasks.find((task) => task.id === reportModal.taskId) ?? null) : null
  const selectedSessions = useMemo(() => {
    if (!selectedTask) return []
    return sessions.filter((session) => session.task_id === selectedTask.id || session.id === selectedTask.sessionId)
  }, [selectedTask, sessions])

  const handleJumpToSession = (sessionId: string, agentId: string) => {
    selectSession(sessionId)
    setSelectedTaskId(null)
    const query = new URLSearchParams({ sessionId, agentId })
    navigate(`${toProjectPath('/workspace')}?${query.toString()}`)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>任务看板</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              navigate(toProjectPath('/tasks/modes'))
            }}
            style={secondaryButtonStyle}
          >
            执行模式
          </button>
          <button type="button" onClick={() => setShowNew(true)} style={primaryButtonStyle}>
            <Plus size={14} /> 新建任务
          </button>
        </div>
      </div>
      <div
        ref={boardRef}
        onScroll={(event) => patchTasks(currentProjectId, { scrollLeft: event.currentTarget.scrollLeft })}
        style={{ display: 'flex', gap: 16, overflowX: 'auto', flex: 1, minHeight: 0 }}
      >
        {COLUMNS.map((column) => {
          const items = grouped.get(column.id) ?? []
          return (
            <div key={column.id} style={columnStyle}>
              <div style={columnHeaderStyle}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: column.color, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{column.title}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)' }}>{items.length}</span>
              </div>
              <div style={columnBodyStyle}>
                {items.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 14, padding: '32px 16px' }}>
                    暂无任务
                  </div>
                ) : (
                  items.map((task) => (
                    <TaskCard key={task.id} task={task} agents={agents} onOpen={() => setSelectedTaskId(task.id)} />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
      {showNew && (
        <CreateTaskModal
          agents={filterAgentsByProject(agents, currentProjectId)}
          projectId={currentProjectId}
          onCreated={(task) => setSelectedTaskId(task.id)}
          onClose={() => setShowNew(false)}
        />
      )}
      {selectedTask && (
        <div onClick={() => setSelectedTaskId(null)} style={overlayStyle}>
          <aside onClick={(event) => event.stopPropagation()} style={detailPanelStyle}>
            <TaskDetailContainer
              task={selectedTask}
              agents={agents}
              modes={modes}
              sessions={selectedSessions}
              onBack={() => setSelectedTaskId(null)}
              onJumpToSession={handleJumpToSession}
              onOpenReportModal={(taskId, eventId) => setReportModal({ taskId, eventId: eventId ?? null })}
            />
          </aside>
        </div>
      )}
      {reportTask && (
        <ReportHistoryModal
          task={reportTask}
          initialEventId={reportModal?.eventId ?? null}
          onClose={() => setReportModal(null)}
          onMarkCompleted={async () => {
            await updateTask(reportTask.id, 'completed', undefined, '人工验收通过')
          }}
        />
      )}
    </div>
  )
}

function filterAgentsByProject(agents: AgentData[], projectId: string | null): AgentData[] {
  return agents.filter((agent) => !projectId || agent.project_id === projectId)
}

const primaryButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  border: 'none',
  background: 'var(--blue)',
  color: 'white',
  fontSize: 15,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: 'var(--shadow-sm)',
}
const secondaryButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  color: 'var(--text-2)',
  fontSize: 14,
  cursor: 'pointer',
}
const columnStyle: React.CSSProperties = {
  minWidth: 280,
  flex: '1 0 280px',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  background: 'var(--bg-2)',
}
const columnHeaderStyle: React.CSSProperties = {
  padding: '14px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexShrink: 0,
}
const columnBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0 10px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.28)',
  zIndex: 1000,
  display: 'flex',
  justifyContent: 'flex-end',
}
const detailPanelStyle: React.CSSProperties = {
  width: 'min(560px, 96vw)',
  height: '100%',
  background: 'var(--bg-0)',
  borderLeft: '1px solid var(--border)',
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
}
