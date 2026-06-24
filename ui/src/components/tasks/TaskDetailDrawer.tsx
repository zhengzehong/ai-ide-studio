import { useState } from 'react'
import { ExternalLink, Trash2, X } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import { useSessionStore } from '../../stores/session.store'
import { useTaskStore, type SessionMode, type TaskData } from '../../stores/task.store'

const SOURCE_META: Record<string, { bg: string; color: string; label: string }> = {
  human: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '手动' },
  agent: { bg: 'var(--green-light)', color: 'var(--green)', label: 'Agent' },
  schedule: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '定时' },
  event: { bg: 'var(--orange-light)', color: 'var(--orange)', label: '事件' },
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  backlog: { label: '待办', color: 'var(--text-3)', bg: 'var(--bg-2)' },
  executing: { label: '执行中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  needs_input: { label: '待确认', color: '#d97706', bg: '#fef3c7' },
  blocked: { label: '已阻塞', color: 'var(--red)', bg: '#fee2e2' },
  reviewing: { label: '审查中', color: '#2563eb', bg: '#dbeafe' },
  completed: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
  cancelled: { label: '已取消', color: 'var(--text-3)', bg: 'var(--bg-2)' },
}

const STATUS_ACTIONS = [
  { status: 'backlog', label: '待办' },
  { status: 'executing', label: '执行中' },
  { status: 'reviewing', label: '审查中' },
  { status: 'completed', label: '已完成' },
  { status: 'blocked', label: '已阻塞' },
  { status: 'cancelled', label: '已取消' },
]

export interface TaskDetailDrawerProps {
  task: TaskData | undefined
  agents: AgentData[]
  embedded?: boolean
  onClose?: () => void
  onOpenSession?: (sessionId: string) => void
  onDeleteComplete?: () => void
}

export function TaskDetailDrawer({ task, agents, embedded = false, onClose, onOpenSession, onDeleteComplete }: TaskDetailDrawerProps) {
  const updateTask = useTaskStore((s) => s.updateTask)
  const updateTaskInfo = useTaskStore((s) => s.updateTaskInfo)
  const assignTask = useTaskStore((s) => s.assignTask)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const sessions = useSessionStore((s) => s.sessions)
  const [updating, setUpdating] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [assignAgentId, setAssignAgentId] = useState('')
  const [assignSessionMode, setAssignSessionMode] = useState<SessionMode>('new_fixed')
  const [assignSessionId, setAssignSessionId] = useState('')

  if (!task) return <EmptyTask embedded={embedded} onClose={onClose} />

  const source = SOURCE_META[task.source] ?? SOURCE_META.human
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.backlog
  const agent = task.assigned_agent_id ? agents.find((item) => item.id === task.assigned_agent_id) : null
  const assignAgentSessions = assignAgentId
    ? sessions.filter((session) => session.agent_id === assignAgentId && (!task.project_id || session.project_id === task.project_id))
    : []

  const startEdit = () => {
    setEditTitle(task.title)
    setEditDesc(task.description || '')
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!editTitle.trim()) return
    await updateTaskInfo(task.id, { title: editTitle.trim(), description: editDesc.trim() || undefined })
    setEditing(false)
  }

  const changeStatus = async (status: string) => {
    setUpdating(status)
    try { await updateTask(task.id, status) } finally { setUpdating(null) }
  }

  const handleAssign = async () => {
    if (!assignAgentId) return
    if (assignSessionMode === 'existing' && !assignSessionId) return
    await assignTask(task.id, assignAgentId, assignSessionMode === 'existing' ? assignSessionId : undefined, assignSessionMode)
    setAssignAgentId('')
    setAssignSessionMode('new_fixed')
    setAssignSessionId('')
  }

  const handleDelete = async () => {
    if (!confirm('确定删除此任务？')) return
    setDeleting(true)
    try {
      await deleteTask(task.id)
      onDeleteComplete?.()
      onClose?.()
    } finally {
      setDeleting(false)
    }
  }

  const content = (
    <TaskDetailContent
      task={task}
      agents={agents}
      source={source}
      statusMeta={statusMeta}
      agentLabel={agent ? `${agent.name} (${agent.runtime})` : '未指派'}
      editing={editing}
      editTitle={editTitle}
      editDesc={editDesc}
      setEditTitle={setEditTitle}
      setEditDesc={setEditDesc}
      startEdit={startEdit}
      saveEdit={saveEdit}
      cancelEdit={() => setEditing(false)}
      updating={updating}
      changeStatus={changeStatus}
      deleting={deleting}
      handleDelete={handleDelete}
      assignAgentId={assignAgentId}
      setAssignAgentId={(value) => { setAssignAgentId(value); setAssignSessionMode('new_fixed'); setAssignSessionId('') }}
      assignSessionMode={assignSessionMode}
      setAssignSessionMode={(value) => { setAssignSessionMode(value); setAssignSessionId('') }}
      assignSessionId={assignSessionId}
      setAssignSessionId={setAssignSessionId}
      assignAgentSessions={assignAgentSessions}
      handleAssign={handleAssign}
      onOpenSession={onOpenSession}
    />
  )

  if (embedded) return <div style={{ height: '100%', overflowY: 'auto' }}>{content}</div>

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.24)', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 92vw)', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24, overflowY: 'auto' }}>
        <PanelHeader title="任务详情" onClose={onClose} />
        {content}
      </aside>
    </>
  )
}

function TaskDetailContent(props: {
  task: TaskData
  agents: AgentData[]
  source: { color: string; label: string }
  statusMeta: { label: string; color: string }
  agentLabel: string
  editing: boolean
  editTitle: string
  editDesc: string
  setEditTitle: (value: string) => void
  setEditDesc: (value: string) => void
  startEdit: () => void
  saveEdit: () => Promise<void>
  cancelEdit: () => void
  updating: string | null
  changeStatus: (status: string) => Promise<void>
  deleting: boolean
  handleDelete: () => Promise<void>
  assignAgentId: string
  setAssignAgentId: (value: string) => void
  assignSessionMode: SessionMode
  setAssignSessionMode: (value: SessionMode) => void
  assignSessionId: string
  setAssignSessionId: (value: string) => void
  assignAgentSessions: Array<{ id: string; title?: string | null; task_id?: string | null }>
  handleAssign: () => Promise<void>
  onOpenSession?: (sessionId: string) => void
}) {
  const st: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' }
  const canAssign = props.assignAgentId && !(props.assignSessionMode === 'existing' && !props.assignSessionId)

  return (
    <>
      {props.editing ? (
        <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={props.editTitle} onChange={(event) => props.setEditTitle(event.target.value)} style={st} placeholder="任务标题" />
          <textarea value={props.editDesc} onChange={(event) => props.setEditDesc(event.target.value)} rows={3} style={{ ...st, resize: 'vertical' }} placeholder="描述" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={props.saveEdit} disabled={!props.editTitle.trim()} style={primaryButtonStyle}>保存</button>
            <button onClick={props.cancelEdit} style={secondaryButtonStyle}>取消</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.45, flex: 1 }}>{props.task.title}</div>
            <button type="button" onClick={props.startEdit} style={smallGhostButtonStyle}>编辑</button>
          </div>
          <div style={{ color: 'var(--text-2)', fontSize: 15, lineHeight: 1.7, marginBottom: 18, whiteSpace: 'pre-wrap' }}>{props.task.description || '暂无描述'}</div>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', marginBottom: 18 }}>
        <DetailRow label="状态" value={props.statusMeta.label} color={props.statusMeta.color} />
        <DetailRow label="阶段" value={props.task.stage || '未设置'} />
        <DetailRow label="指派 Agent" value={props.agentLabel} />
        <DetailRow label="来源" value={props.source.label} color={props.source.color} />
        <DetailRow label="创建时间" value={formatDateTime(props.task.created_at)} />
        {props.task.completed_at && <DetailRow label="完成时间" value={formatDateTime(props.task.completed_at)} />}
        {props.task.sessionId && props.onOpenSession && (
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 14 }}>
            <span style={{ color: 'var(--text-3)' }}>关联对话</span>
            <button type="button" onClick={() => props.onOpenSession?.(props.task.sessionId!)} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--blue)', cursor: 'pointer', border: 'none', background: 'none', padding: 0, fontSize: 14 }}>
              <ExternalLink size={11} />打开对话
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>指派 Agent</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select value={props.assignAgentId} onChange={(event) => props.setAssignAgentId(event.target.value)} style={{ ...st, flex: 1 }}>
          <option value="">选择 Agent</option>
          {props.agents.filter((agent) => agent.id !== props.task.assigned_agent_id).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <button onClick={props.handleAssign} disabled={!canAssign} style={{ ...primaryButtonStyle, background: canAssign ? 'var(--blue)' : 'var(--bg-2)', color: canAssign ? 'white' : 'var(--text-3)' }}>指派</button>
      </div>
      {props.assignAgentId && (
        <div style={{ marginBottom: 18 }}>
          <SessionModeSelect
            mode={props.assignSessionMode}
            sessionId={props.assignSessionId}
            sessions={props.assignAgentSessions}
            onModeChange={props.setAssignSessionMode}
            onSessionChange={props.setAssignSessionId}
            inputStyle={st}
          />
        </div>
      )}

      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>状态操作</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {STATUS_ACTIONS.map((action) => (
          <button key={action.status} type="button" onClick={() => props.changeStatus(action.status)} disabled={props.updating !== null || props.task.status === action.status} style={{ padding: '7px 12px', borderRadius: 8, border: props.task.status === action.status ? '1px solid var(--blue)' : '1px solid var(--border)', background: props.task.status === action.status ? 'var(--blue-light)' : 'var(--bg-0)', color: props.task.status === action.status ? 'var(--blue)' : 'var(--text-2)', fontSize: 14, cursor: props.task.status === action.status ? 'default' : 'pointer', opacity: props.updating && props.updating !== action.status ? 0.6 : 1 }}>
            {props.updating === action.status ? '...' : action.label}
          </button>
        ))}
      </div>

      <button type="button" onClick={props.handleDelete} disabled={props.deleting} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 14, cursor: 'pointer' }}>
        <Trash2 size={13} /> {props.deleting ? '删除中...' : '删除任务'}
      </button>
    </>
  )
}

function EmptyTask({ embedded, onClose }: { embedded: boolean; onClose?: () => void }) {
  const content = <div style={{ color: 'var(--text-3)', fontSize: 14, padding: 20, textAlign: 'center' }}>请选择任务</div>
  if (embedded) return content
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.24)', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 92vw)', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <PanelHeader title="任务详情" onClose={onClose} />
        {content}
      </aside>
    </>
  )
}

function PanelHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
      <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{title}</h2>
      {onClose && <button type="button" onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={15} /></button>}
    </div>
  )
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 14 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-1)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

function SessionModeSelect({ mode, sessionId, sessions, onModeChange, onSessionChange, inputStyle }: {
  mode: SessionMode
  sessionId: string
  sessions: Array<{ id: string; title?: string | null; task_id?: string | null }>
  onModeChange: (value: SessionMode) => void
  onSessionChange: (value: string) => void
  inputStyle: React.CSSProperties
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select value={mode} onChange={(event) => onModeChange(event.target.value as SessionMode)} style={inputStyle}>
        <option value="new_fixed">固定新会话</option>
        <option value="new_each">每次新会话</option>
        <option value="existing">指定已有会话</option>
      </select>
      {mode === 'existing' && (
        <select value={sessionId} onChange={(event) => onSessionChange(event.target.value)} style={inputStyle}>
          <option value="">请选择已有会话</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{sessionOptionLabel(session)}</option>)}
        </select>
      )}
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{sessionModeHelp(mode, Boolean(sessionId))}</div>
    </div>
  )
}

function sessionModeHelp(mode: SessionMode, hasSession: boolean): string {
  if (mode === 'existing') return hasSession ? '将在该会话中追加任务指派。' : '请选择一个已有会话。'
  if (mode === 'new_fixed') return '将创建一个新的固定会话用于这次任务。'
  return '将为这次任务创建新的会话。'
}

function sessionOptionLabel(session: { id: string; title?: string | null; task_id?: string | null }): string {
  const title = session.title?.trim()
  return title ? title : `${session.id.slice(0, 8)}...${session.task_id ? '（有任务）' : ''}`
}

function formatDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN') } catch { return iso }
}

const primaryButtonStyle: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 14, cursor: 'pointer' }
const secondaryButtonStyle: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }
const smallGhostButtonStyle: React.CSSProperties = { border: 'none', background: 'var(--bg-2)', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }
