import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { wsClient } from '@desktop/services/ws-client'
import { ListTodo, Clock, CheckCircle2, AlertCircle, Circle, RefreshCw, PauseCircle } from 'lucide-react'
import type { TaskStatus } from '../../../src/types/ws-protocol'
import { useAppStore } from '../stores/app.store'

interface TaskItem {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority?: string
  created_at: string
  agent_id?: string
  project_id?: string | null
}

type TaskStatusMeta = { icon: typeof Clock; color: string; label: string }

const statusConfig: Record<TaskStatus, TaskStatusMeta> = {
  backlog: { icon: Circle, color: 'var(--text-muted)', label: '待办' },
  executing: { icon: Clock, color: 'var(--info)', label: '执行中' },
  needs_input: { icon: AlertCircle, color: 'var(--warning)', label: '需输入' },
  blocked: { icon: PauseCircle, color: 'var(--error)', label: '受阻' },
  reviewing: { icon: AlertCircle, color: 'var(--primary)', label: '待确认' },
  completed: { icon: CheckCircle2, color: 'var(--success)', label: '已完成' },
  cancelled: { icon: AlertCircle, color: 'var(--text-muted)', label: '已取消' },
}

export function mobileTaskStatusMeta(status: TaskStatus): TaskStatusMeta {
  return statusConfig[status] || statusConfig.backlog
}

export function taskListRequest(projectId: string | null): Record<string, unknown> {
  const request: Record<string, unknown> = { type: 'tasks.list' }
  if (projectId) request.projectId = projectId
  return request
}

function taskInProject(data: Record<string, unknown>, projectId: string | null, existing?: TaskItem): boolean {
  if (!projectId) return true
  if (data.project_id === undefined) return existing?.project_id === projectId
  return data.project_id === projectId
}

export function mergeMobileTaskUpdate(
  tasks: TaskItem[],
  data: Record<string, unknown>,
  projectId: string | null,
): TaskItem[] {
  const taskId = typeof data.id === 'string' ? data.id : ''
  if (!taskId) return tasks
  if (data.event === 'deleted') return tasks.filter((task) => task.id !== taskId)

  const incoming = data as unknown as TaskItem
  const existingIndex = tasks.findIndex((task) => task.id === taskId)
  const existing = existingIndex >= 0 ? tasks[existingIndex] : undefined
  if (!taskInProject(data, projectId, existing)) return tasks
  if (existingIndex < 0) return [incoming, ...tasks]
  return tasks.map((task, index) => (index === existingIndex ? { ...task, ...incoming } : task))
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const currentProjectId = useAppStore((state) => state.currentProjectId)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const data = await wsClient.request(taskListRequest(currentProjectId)) as TaskItem[]
      setTasks(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [currentProjectId])

  useEffect(() => { void fetchTasks() }, [fetchTasks])

  useEffect(() => {
    const off = wsClient.on('task:update', (msg) => {
      const taskId = typeof msg.taskId === 'string' ? msg.taskId : ''
      const data = msg.data && typeof msg.data === 'object'
        ? { ...(msg.data as Record<string, unknown>), id: (msg.data as Record<string, unknown>).id ?? taskId }
        : { id: taskId }
      setTasks((current) => mergeMobileTaskUpdate(current, data, currentProjectId))
    })
    return () => { off() }
  }, [currentProjectId])

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <ListTodo size={20} color="var(--primary)" />
          <span style={styles.headerTitle}>任务</span>
        </div>
        <button style={styles.refreshBtn} onClick={fetchTasks}>
          <RefreshCw size={16} color="var(--text-secondary)" />
        </button>
      </div>

      <div style={styles.list}>
        {loading && <div style={styles.empty}>加载中...</div>}
        {!loading && tasks.length === 0 && (
          <div style={styles.empty}>
            <ListTodo size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>暂无任务</span>
          </div>
        )}
        {tasks.map(task => {
          const cfg = mobileTaskStatusMeta(task.status)
          const Icon = cfg.icon
          return (
            <div key={task.id} style={styles.card}>
              <div style={styles.cardRow}>
                <Icon size={16} color={cfg.color} />
                <span style={styles.cardTitle}>{task.title}</span>
                <span style={{ ...styles.statusTag, color: cfg.color, background: `${cfg.color}15` }}>{cfg.label}</span>
              </div>
              {task.description && (
                <div style={styles.cardDesc}>{task.description}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-input)',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 16px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '60%',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  card: {
    padding: '12px 14px',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius)',
    marginBottom: 8,
    border: '1px solid var(--border-light)',
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusTag: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 500,
    flexShrink: 0,
  },
  cardDesc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    marginTop: 6,
    lineHeight: 1.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
}
