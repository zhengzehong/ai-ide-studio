import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { wsClient } from '@desktop/services/ws-client'
import { ListTodo, RefreshCw, Search, X } from 'lucide-react'
import type { TaskStatus } from '../../../src/types/ws-protocol'
import { useAppStore } from '../stores/app.store'
import { useSessionStore } from '../stores/session.store'
import ActionSheet from '../components/ActionSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import TaskCard, { type TaskCardItem } from '../components/task/TaskCard'
import { showToast } from '../utils/toast'
import { markTaskRead, isTaskUnread } from '../utils/task-unread'

type TaskFilter = 'mine' | 'all' | 'running' | 'draft' | 'done'

interface TaskItem {
  id: string
  title: string
  description?: string | null
  status: TaskStatus
  created_at: string
  updated_at?: string | null
  assigned_agent_id?: string | null
  project_id?: string | null
  stage?: string | null
}

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: 'mine', label: '待确认' },
  { key: 'all', label: '全部' },
  { key: 'running', label: '进行中' },
  { key: 'draft', label: '待办' },
  { key: 'done', label: '已完成' },
]

const EMPTY_TEXT: Record<TaskFilter, string> = {
  mine: '暂无待确认任务',
  all: '暂无任务',
  running: '暂无进行中的任务',
  draft: '暂无待办任务',
  done: '暂无已完成任务',
}

type MobileTaskStatus = TaskStatus | 'backlog' | 'executing'

export function mobileTaskStatusMeta(status: MobileTaskStatus): { color: string; label: string } {
  if (status === 'running' || status === 'executing') return { color: 'var(--info)', label: '执行中' }
  if (status === 'needs_input') return { color: 'var(--warning)', label: '需确认' }
  if (status === 'completed') return { color: 'var(--success)', label: '已完成' }
  if (status === 'cancelled') return { color: 'var(--text-muted)', label: '已取消' }
  return { color: 'var(--text-muted)', label: '待办' }
}

function matchesFilter(status: TaskStatus, filter: TaskFilter, assignedAgentId: string | null | undefined, currentAgentId: string | null): boolean {
  switch (filter) {
    case 'mine':
      if (status !== 'needs_input') return false
      if (!currentAgentId) return true
      return assignedAgentId === currentAgentId
    case 'running':
      return status === 'running'
    case 'draft':
      return status === 'draft'
    case 'done':
      return status === 'completed' || status === 'cancelled'
    case 'all':
      return true
  }
}

function matchesSearch(title: string, description: string | null | undefined, keyword: string): boolean {
  if (!keyword) return true
  const lower = keyword.toLowerCase()
  if (title.toLowerCase().includes(lower)) return true
  if (description && description.toLowerCase().includes(lower)) return true
  return false
}

function toTime(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

function sortTasks<T extends { updated_at?: string | null; created_at: string }>(tasks: T[]): T[] {
  return tasks.slice().sort((a, b) => toTime(b.updated_at || b.created_at) - toTime(a.updated_at || a.created_at))
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
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TaskFilter>('mine')
  const [keyword, setKeyword] = useState('')
  const [actionTask, setActionTask] = useState<TaskItem | null>(null)
  const [confirmTask, setConfirmTask] = useState<TaskItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const currentProjectId = useAppStore((state) => state.currentProjectId)
  const agents = useAppStore((state) => state.agents)
  const agentsRef = useRef(agents)
  agentsRef.current = agents
  const currentSessionId = useSessionStore((state) => state.currentSessionId)
  const sessions = useSessionStore((state) => state.sessions)
  const currentAgentId = useMemo(() => {
    if (!currentSessionId) return null
    return sessions.find((s) => s.id === currentSessionId)?.agentId ?? null
  }, [currentSessionId, sessions])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const data = (await wsClient.request(taskListRequest(currentProjectId))) as TaskItem[]
      setTasks(data)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [currentProjectId])

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const off = wsClient.on('task:update', (msg) => {
      const taskId = typeof msg.taskId === 'string' ? msg.taskId : ''
      const data =
        msg.data && typeof msg.data === 'object'
          ? { ...(msg.data as Record<string, unknown>), id: (msg.data as Record<string, unknown>).id ?? taskId }
          : { id: taskId }
      setTasks((current) => mergeMobileTaskUpdate(current, data, currentProjectId))
    })
    return () => {
      off()
    }
  }, [currentProjectId])

  const tasksWithAgent = useMemo<TaskCardItem[]>(() => {
    const agentMap = new Map(agentsRef.current.map((a) => [a.id, a.name]))
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      stage: t.stage ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at ?? null,
      assigned_agent_id: t.assigned_agent_id ?? null,
      agent_name: t.assigned_agent_id ? (agentMap.get(t.assigned_agent_id) ?? null) : null,
      project_id: t.project_id ?? null,
    }))
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const filtered = tasksWithAgent.filter(
      (t) => matchesFilter(t.status, filter, t.assigned_agent_id, currentAgentId) && matchesSearch(t.title, t.description, keyword),
    )
    return sortTasks(filtered)
  }, [tasksWithAgent, filter, keyword, currentAgentId])

  const handleCardClick = useCallback(
    (task: TaskCardItem) => {
      markTaskRead(task.id)
      navigate(`/task/${task.id}`)
    },
    [navigate],
  )

  const handleLongPress = useCallback(
    (task: TaskCardItem) => {
      setActionTask(tasks.find((t) => t.id === task.id) ?? null)
    },
    [tasks],
  )

  const handleCopyTitle = useCallback(async () => {
    if (!actionTask) return
    try {
      await navigator.clipboard.writeText(actionTask.title)
      showToast('已复制任务标题')
    } catch {
      showToast('复制失败')
    }
  }, [actionTask])

  const handleMarkRead = useCallback(() => {
    if (!actionTask) return
    markTaskRead(actionTask.id)
    showToast('已标记为已读')
    setTasks((prev) => prev.map((t) => (t.id === actionTask.id ? { ...t } : t)))
  }, [actionTask])

  const handleDeleteRequest = useCallback(() => {
    if (!actionTask) return
    setConfirmTask(actionTask)
  }, [actionTask])

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmTask) return
    const taskToDelete = confirmTask
    setConfirmTask(null)
    setActionTask(null)
    setDeleting(true)
    const snapshot = tasks
    setTasks((prev) => prev.filter((t) => t.id !== taskToDelete.id))
    try {
      await wsClient.request({ type: 'tasks.delete', taskId: taskToDelete.id })
      showToast('任务已删除')
    } catch {
      setTasks(snapshot)
      showToast('删除失败,已恢复')
    } finally {
      setDeleting(false)
    }
  }, [confirmTask, tasks])

  const hasUnread = actionTask
    ? ((): boolean => {
        const t = tasksWithAgent.find((x) => x.id === actionTask.id)
        if (!t) return false
        return isTaskUnread(t.id, t.updated_at || undefined)
      })()
    : false

  const actionSheetItems = (() => {
    if (!actionTask) return []
    type Item = { key: string; label: string; danger?: boolean; onClick: () => void }
    const items: Item[] = [
      {
        key: 'copy',
        label: '复制任务标题',
        onClick: () => {
          void handleCopyTitle()
        },
      },
    ]
    if (hasUnread) {
      items.push({ key: 'read', label: '标记已读', onClick: handleMarkRead })
    }
    items.push({ key: 'delete', label: '删除任务', danger: true, onClick: handleDeleteRequest })
    return items
  })()

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <ListTodo size={20} color="var(--primary)" />
          <span style={styles.headerTitle}>任务</span>
        </div>
        <button style={styles.refreshBtn} onClick={fetchTasks} disabled={loading || deleting}>
          <RefreshCw size={16} color="var(--text-secondary)" className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div style={styles.filterBar}>
        <div style={styles.chips}>
          {FILTERS.map((f) => {
            const active = f.key === filter
            return (
              <button
                key={f.key}
                style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            )
          })}
        </div>
        <div style={styles.searchBox}>
          <Search size={14} color="var(--text-muted)" />
          <input
            style={styles.searchInput}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索任务"
          />
          {keyword && (
            <button style={styles.clearBtn} onClick={() => setKeyword('')}>
              <X size={12} color="var(--text-muted)" />
            </button>
          )}
        </div>
      </div>

      <div style={styles.list}>
        {loading && <div style={styles.empty}>加载中...</div>}
        {!loading && filteredTasks.length === 0 && (
          <div style={styles.empty}>
            <ListTodo size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>{EMPTY_TEXT[filter]}</span>
          </div>
        )}
        {!loading &&
          filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={handleCardClick} onLongPress={handleLongPress} />
          ))}
      </div>

      <ActionSheet
        open={!!actionTask && !confirmTask}
        title={actionTask?.title ?? ''}
        onClose={() => setActionTask(null)}
        items={actionSheetItems}
      />

      <ConfirmDialog
        open={!!confirmTask}
        title="删除任务"
        message={`确定要删除任务「${confirmTask?.title ?? ''}」吗?此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmTask(null)}
      />
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
  filterBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '10px 16px',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  chips: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  chip: {
    flexShrink: 0,
    padding: '6px 14px',
    borderRadius: 16,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'var(--bg-input)',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
  },
  chipActive: {
    background: 'var(--primary)',
    color: '#fff',
    fontWeight: 600,
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'var(--bg-input)',
    borderRadius: 'var(--radius-sm)',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--text-primary)',
    minWidth: 0,
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'var(--border-light)',
    flexShrink: 0,
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
}
