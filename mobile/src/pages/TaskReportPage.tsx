import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, AlertCircle, Loader2 } from 'lucide-react'
import { wsClient } from '@desktop/services/ws-client'
import MarkdownView from '../components/MarkdownView'
import { showToast } from '../utils/toast'
import { formatRelativeTime } from '../utils/task-time'
import type { TaskReportDetail } from '../stores/task-detail.store'
import { getEventMeta } from '../components/task/TaskReportItem'

const EVENT_LABEL: Record<string, string> = {
  milestone: '里程碑',
  input_requested: '需要确认',
  marked_done: '完成',
  created: '创建',
  assigned: '指派',
  replied: '回复',
  status_changed: '状态变更',
  manual_status_change: '状态变更',
  updated: '更新',
  stage_updated: '阶段更新',
  agent_status_changed: 'Agent 状态变更',
  session_linked: '会话关联',
  deleted: '删除',
  assigned_agent: '指派',
}

export default function TaskReportPage() {
  const { taskId = '', eventId = '' } = useParams<{ taskId: string; eventId: string }>()
  const navigate = useNavigate()
  const [report, setReport] = useState<TaskReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!taskId || !eventId) return
    setLoading(true)
    setError(null)
    wsClient
      .request({ type: 'tasks.events.get', taskId, eventId })
      .then((data) => {
        setReport(data as TaskReportDetail)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载失败')
        setLoading(false)
      })
  }, [taskId, eventId])

  const handleCopy = async () => {
    if (!report?.reportMd) return
    try {
      await navigator.clipboard.writeText(report.reportMd)
      showToast('已复制 Markdown')
    } catch {
      showToast('复制失败')
    }
  }

  const headerLabel = report ? (EVENT_LABEL[report.type] || report.type) : ''
  const headerTime = report ? formatRelativeTime(report.createdAt) : ''
  const meta = report ? getEventMeta(report.type) : null
  const headerColor = meta?.color || 'var(--text-secondary)'

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.iconBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
        <span style={styles.headerTitle}>
          <span style={{ color: headerColor }}>{headerLabel}</span>
          {headerTime && <span style={styles.headerTime}> · {headerTime}</span>}
        </span>
        <button
          style={{ ...styles.iconBtn, ...(!report?.reportMd ? styles.disabledBtn : {}) }}
          onClick={() => { void handleCopy() }}
          disabled={!report?.reportMd}
        >
          <Copy size={18} />
        </button>
      </div>

      <div style={styles.body}>
        {loading && (
          <div style={styles.empty}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
            <span style={styles.emptyText}>加载中...</span>
          </div>
        )}
        {!loading && error && (
          <div style={styles.empty}>
            <AlertCircle size={36} color="var(--text-muted)" />
            <span style={styles.emptyText}>{error}</span>
          </div>
        )}
        {!loading && !error && report && (
          report.reportMd
            ? <MarkdownView content={report.reportMd} />
            : (
              <div style={styles.empty}>
                <AlertCircle size={36} color="var(--text-muted)" />
                <span style={styles.emptyText}>该事件没有 Markdown 报告内容</span>
              </div>
            )
        )}
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
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
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
    flexShrink: 0,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerTime: {
    color: 'var(--text-muted)',
    fontWeight: 400,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 16,
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
    minHeight: 200,
  },
  emptyText: {
    fontSize: 13,
    color: 'var(--text-muted)',
  },
}
