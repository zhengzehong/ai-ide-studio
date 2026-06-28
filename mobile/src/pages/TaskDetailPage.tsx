import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MoreVertical, ChevronDown, MessageSquare, AlertCircle } from 'lucide-react'
import { wsClient } from '@desktop/services/ws-client'
import type { TaskStatus } from '../../../src/types/ws-protocol'
import { useAppStore } from '../stores/app.store'
import { useTaskDetailStore } from '../stores/task-detail.store'
import { showToast } from '../utils/toast'
import { markTaskRead, getTaskLastSeen } from '../utils/task-unread'
import { formatRelativeTime, formatDuration, diffMsFromNow } from '../utils/task-time'
import ActionSheet from '../components/ActionSheet'
import ConfirmDialog from '../components/ConfirmDialog'
import MarkdownView from '../components/MarkdownView'
import TaskReportItem, { type ReportFilterMode } from '../components/task/TaskReportItem'
import TaskActionBar from '../components/task/TaskActionBar'

const STATUS_META: Record<TaskStatus, { color: string; label: string }> = {
  backlog: { color: 'var(--text-muted)', label: '待办' },
  executing: { color: 'var(--info)', label: '行动中' },
  needs_input: { color: 'var(--warning)', label: '需要确认' },
  completed: { color: 'var(--success)', label: '已完成' },
  cancelled: { color: 'var(--text-muted)', label: '已取消' },
}

const AGENT_REPORT_EVENTS = new Set(['milestone', 'input_requested', 'marked_done'])

export default function TaskDetailPage() {
  const { taskId = '' } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const agents = useAppStore((state) => state.agents)
  const { task, events, loading, eventsLoading, load, updateStatus, deleteTask, reset } = useTaskDetailStore()
  const taskLatestReportAt = task?.latestReportAt || null

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'reject' | 'cancel' | 'delete' }>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [reportFilter, setReportFilter] = useState<ReportFilterMode>('agent')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!taskId) return
    void load(taskId)
    return () => { reset() }
  }, [taskId, load, reset])

  useEffect(() => {
    if (!taskId) return
    const off = wsClient.on('task:update', (msg) => {
      if (typeof msg.taskId !== 'string' || msg.taskId !== taskId) return
      const data = msg.data && typeof msg.data === 'object' ? msg.data as Record<string, unknown> : {}
      if (data.event === 'deleted') {
        showToast('任务已被删除')
        navigate(-1)
        return
      }
      void load(taskId)
    })
    return () => { off() }
  }, [taskId, load, navigate])

  useEffect(() => {
    if (!task) return
    markTaskRead(task.id)
  }, [task?.id, taskLatestReportAt])

  const agentName = useMemo(() => {
    if (!task?.assigned_agent_id) return null
    const found = agents.find(a => a.id === task.assigned_agent_id)
    return found?.name ?? null
  }, [task?.assigned_agent_id, agents])

  const latestSessionId = task?.sessions?.[task.sessions.length - 1]?.id ?? null

  const filteredEvents = useMemo(() => {
    if (reportFilter === 'all') return events
    return events.filter(e => AGENT_REPORT_EVENTS.has(e.type))
  }, [events, reportFilter])

  const unreadEventIds = useMemo(() => {
    const ids = new Set<string>()
    if (!task) return ids
    const lastSeenRaw = getTaskLastSeen(task.id)
    for (const ev of events) {
      if (!AGENT_REPORT_EVENTS.has(ev.type)) continue
      if (!lastSeenRaw) { ids.add(ev.id); continue }
      if (new Date(ev.created_at).getTime() > new Date(lastSeenRaw).getTime()) {
        ids.add(ev.id)
      }
    }
    return ids
  }, [events, task])

  const handleOpenReport = useCallback((eventId: string) => {
    navigate(`/task/${taskId}/report/${eventId}`)
  }, [navigate, taskId])

  const handleOpenSession = useCallback(() => {
    if (!latestSessionId) return
    navigate(`/chat/${latestSessionId}`)
  }, [latestSessionId, navigate])

  const handleApprove = useCallback(async () => {
    setBusy(true)
    try {
      await updateStatus('executing', '人工批准继续')
      showToast('已批准继续')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleAccept = useCallback(async () => {
    setBusy(true)
    try {
      await updateStatus('completed', '人工验收通过')
      showToast('已验收通过')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleReject = useCallback(async () => {
    setConfirm(null)
    setBusy(true)
    try {
      await updateStatus('executing', '人工驳回,继续执行')
      showToast('已驳回')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleCancel = useCallback(async () => {
    setConfirm(null)
    setBusy(true)
    try {
      await updateStatus('cancelled', '人工取消')
      showToast('已取消任务')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleStart = useCallback(async () => {
    setBusy(true)
    try {
      await updateStatus('executing', '人工启动')
      showToast('已启动任务')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleReopen = useCallback(async () => {
    setBusy(true)
    try {
      await updateStatus('backlog', '人工重新打开')
      showToast('已重新打开')
    } catch { showToast('操作失败') } finally { setBusy(false) }
  }, [updateStatus])

  const handleDeleteRequest = useCallback(() => {
    setConfirm({ kind: 'delete' })
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    setConfirm(null)
    setBusy(true)
    try {
      await deleteTask()
      showToast('任务已删除')
      navigate(-1)
    } catch {
      showToast('删除失败')
      setBusy(false)
    }
  }, [deleteTask, navigate])

  const handleCopyTitle = useCallback(async () => {
    if (!task) return
    try { await navigator.clipboard.writeText(task.title); showToast('已复制任务标题') } catch { showToast('复制失败') }
  }, [task])

  const handleCopyId = useCallback(async () => {
    if (!task) return
    try { await navigator.clipboard.writeText(task.id); showToast('已复制任务 ID') } catch { showToast('复制失败') }
  }, [task])

  if (loading && !task) {
    return (
      <div style={styles.page}>
        <Header title="任务详情" onBack={() => navigate(-1)} />
        <div style={styles.empty}><span style={styles.emptyText}>加载中...</span></div>
      </div>
    )
  }

  if (!task) {
    return (
      <div style={styles.page}>
        <Header title="任务详情" onBack={() => navigate(-1)} />
        <div style={styles.empty}>
          <AlertCircle size={36} color="var(--text-muted)" />
          <span style={styles.emptyText}>任务不存在或加载失败</span>
        </div>
      </div>
    )
  }

  const statusMeta = STATUS_META[task.status]
  const isReviewing = task.status === 'needs_input' && task.agent_report_status === 'done'
  const waitSince = taskLatestReportAt || task.created_at
  const waitMs = (task.status === 'needs_input' || isReviewing) ? diffMsFromNow(waitSince) : 0

  const menuItems = [
    { key: 'copyTitle', label: '复制任务标题', onClick: () => { void handleCopyTitle() } },
    { key: 'copyId', label: '复制任务 ID', onClick: () => { void handleCopyId() } },
    { key: 'delete', label: '删除任务', danger: true, onClick: handleDeleteRequest },
  ]

  return (
    <div style={styles.page}>
      <Header
        title={task.title}
        onBack={() => navigate(-1)}
        right={<button style={styles.iconBtn} onClick={() => setMenuOpen(true)}><MoreVertical size={18} /></button>}
      />

      <div style={styles.scroll}>
        <div style={styles.statusBar}>
          <div style={styles.statusRow}>
            <span style={{ ...styles.statusDot, background: statusMeta.color }} />
            <span style={{ ...styles.statusText, color: statusMeta.color }}>{statusMeta.label}</span>
            <span style={styles.agentName}>{agentName || '未指派'}</span>
          </div>
          <div style={styles.metaRow}>
            <span style={styles.metaText}>创建 {formatRelativeTime(task.created_at)}</span>
            {waitMs > 0 && <span style={styles.metaText}>已等待 {formatDuration(waitMs)}</span>}
            {taskLatestReportAt && <span style={styles.metaText}>最近汇报 {formatRelativeTime(taskLatestReportAt)}</span>}
            <button
              style={{ ...styles.iconBtn, ...(latestSessionId ? {} : styles.disabledBtn) }}
              onClick={handleOpenSession}
              disabled={!latestSessionId}
            >
              <MessageSquare size={14} />
            </button>
          </div>
        </div>

        {task.description && (
          <Section title="描述">
            <div style={{ ...styles.descWrap, ...(descExpanded ? {} : styles.descCollapsed) }}>
              <MarkdownView content={task.description} compact />
            </div>
            <button style={styles.expandBtn} onClick={() => setDescExpanded(v => !v)}>
              {descExpanded ? '收起 ▲' : '展开 ▼'}
            </button>
          </Section>
        )}

        <Section
          title={`Agent 汇报 (${filteredEvents.length})`}
          right={
            <button style={styles.filterBtn} onClick={() => setReportFilter(v => v === 'agent' ? 'all' : 'agent')}>
              {reportFilter === 'agent' ? 'Agent 汇报' : '全部活动'}
              <ChevronDown size={12} />
            </button>
          }
        >
          {eventsLoading && <div style={styles.emptyText}>加载中...</div>}
          {!eventsLoading && filteredEvents.length === 0 && (
            <div style={styles.emptyText}>{reportFilter === 'agent' ? '暂无 Agent 汇报' : '暂无活动'}</div>
          )}
          {!eventsLoading && filteredEvents.map(event => (
            <TaskReportItem
              key={event.id}
              event={event}
              unread={unreadEventIds.has(event.id)}
              onClick={(e) => handleOpenReport(e.id)}
            />
          ))}
        </Section>
      </div>

      <TaskActionBar
        status={task.status}
        agentReportStatus={task.agent_report_status}
        hasSession={!!latestSessionId}
        onOpenSession={handleOpenSession}
        onApprove={handleApprove}
        onAccept={handleAccept}
        onReject={() => setConfirm({ kind: 'reject' })}
        onCancel={() => setConfirm({ kind: 'cancel' })}
        onStart={handleStart}
        onReopen={handleReopen}
        onDelete={handleDeleteRequest}
        busy={busy}
      />

      <ActionSheet
        open={menuOpen}
        title={task.title}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'delete' ? '删除任务' : confirm?.kind === 'cancel' ? '取消任务' : '驳回任务'}
        message={
          confirm?.kind === 'delete' ? `确定要删除任务「${task.title}」吗?此操作不可恢复。`
          : confirm?.kind === 'cancel' ? '取消后任务将不再执行,确认取消?'
          : '驳回后任务会回到执行中状态,确认驳回?'
        }
        confirmText={confirm?.kind === 'delete' ? '删除' : confirm?.kind === 'cancel' ? '取消任务' : '驳回'}
        danger
        onConfirm={() => {
          if (confirm?.kind === 'reject') void handleReject()
          else if (confirm?.kind === 'cancel') void handleCancel()
          else void handleDeleteConfirm()
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div style={styles.header}>
      <button style={styles.iconBtn} onClick={onBack}><ArrowLeft size={20} /></button>
      <span style={styles.headerTitle}>{title}</span>
      <div style={styles.headerRight}>{right}</div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>{title}</span>
        {right}
      </div>
      {children}
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
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--text-primary)',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    color: 'var(--text-muted)',
    padding: 32,
  },
  emptyText: {
    fontSize: 13,
    color: 'var(--text-muted)',
    padding: 16,
    textAlign: 'center' as const,
  },
  statusBar: {
    margin: '0 16px 8px',
    padding: '10px 12px',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-light)',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 13,
    fontWeight: 600,
  },
  agentName: {
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  metaText: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  section: {
    margin: '0 16px 12px',
    padding: '12px',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-light)',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  filterBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: 'var(--primary)',
    background: 'transparent',
  },
  descWrap: {
    color: 'var(--text-primary)',
  },
  descCollapsed: {
    maxHeight: 60,
    overflow: 'hidden',
  },
  expandBtn: {
    marginTop: 4,
    fontSize: 12,
    color: 'var(--primary)',
    background: 'transparent',
    padding: 0,
  },
}
