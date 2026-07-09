import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useTaskStore, type TaskData, type TaskEventData } from '../../../stores/task.store'
import { MarkdownRenderer } from '../../../components/MarkdownRenderer'
import {
  TASK_EVENT_TYPE_META,
  eventStage,
  formatRelativeTime,
} from './task-helpers'

interface ReportModalProps {
  task: TaskData
  events: TaskEventData[]
  initialEventId: string | null
  onClose: () => void
  onMarkCompleted?: () => Promise<void> | void
}

export function ReportModal({ task, events, initialEventId, onClose, onMarkCompleted }: ReportModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId && events.some((ev) => ev.id === initialEventId) ? initialEventId : (events[0]?.id ?? null),
  )
  const [copied, setCopied] = useState(false)
  const [marking, setMarking] = useState(false)
  const selected = events.find((ev) => ev.id === selectedId) ?? events[0] ?? null
  const reportMd = selected ? extractMd(selected) : ''
  const canMarkComplete = !!onMarkCompleted && (task.status === 'running' || task.status === 'needs_input')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportMd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  const handleMarkComplete = async () => {
    if (!onMarkCompleted || marking) return
    setMarking(true)
    try { await onMarkCompleted() } finally { setMarking(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-0)', borderRadius: 12, width: '100%', maxWidth: 960, maxHeight: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              汇报历史 · {task.title}
            </div>
            {selected && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {TASK_EVENT_TYPE_META[selected.type]?.label ?? selected.type} · {formatRelativeTime(selected.created_at)}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {events.length > 1 && (
            <div style={{ width: 240, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 8, flexShrink: 0 }}>
              {events.map((ev) => {
                const meta = TASK_EVENT_TYPE_META[ev.type] ?? { label: ev.type, color: 'var(--text-3)', bg: 'var(--bg-2)' }
                const stage = eventStage(ev)
                const isSelected = selected?.id === ev.id
                return (
                  <button key={ev.id} type="button" onClick={() => setSelectedId(ev.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, border: isSelected ? '1px solid #165dff' : '1px solid transparent', background: isSelected ? '#e8f3ff' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left', width: '100%', marginBottom: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 6, background: meta.bg, color: meta.color }}>{meta.label}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>{formatRelativeTime(ev.created_at)}</span>
                      </div>
                      {stage && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {stage}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', minWidth: 0 }}>
            {reportMd ? <MarkdownRenderer content={reportMd} /> : <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>该条记录没有汇报内容</div>}
          </div>
        </div>
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--bg-1)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>共 {events.length} 条汇报</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleCopy} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>
              {copied ? '已复制' : '复制原文'}
            </button>
            <button type="button" onClick={onClose} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer' }}>
              关闭
            </button>
            {canMarkComplete && (
              <button type="button" onClick={handleMarkComplete} disabled={marking} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: marking ? 'var(--bg-2)' : 'var(--green)', color: marking ? 'var(--text-3)' : 'white', fontSize: 13, fontWeight: 500, cursor: marking ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={12} />
                {marking ? '处理中...' : '标记完成'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ReportHistoryModalProps {
  task: TaskData
  onClose: () => void
  onMarkCompleted?: () => Promise<void> | void
  initialEventId?: string | null
}

export function ReportHistoryModal({ task, onClose, onMarkCompleted, initialEventId }: ReportHistoryModalProps) {
  const fetchTaskEvents = useTaskStore((s) => s.fetchTaskEvents)
  const [events, setEvents] = useState<TaskEventData[]>([])

  useEffect(() => {
    let cancelled = false
    fetchTaskEvents(task.id).then((loaded) => { if (!cancelled) setEvents(loaded) })
    return () => { cancelled = true }
  }, [task.id, fetchTaskEvents])

  const reportEvents = events
    .filter((ev) => isReportEvent(ev) && extractMd(ev))
    .sort((a, b) => b.sequence - a.sequence)

  return (
    <ReportModal
      task={task}
      events={reportEvents}
      initialEventId={initialEventId ?? reportEvents[0]?.id ?? null}
      onClose={onClose}
      onMarkCompleted={onMarkCompleted}
    />
  )
}

const REPORT_TYPES = new Set(['progress', 'input_requested', 'marked_done', 'milestone', 'replied', 'step_report'])

function isReportEvent(ev: TaskEventData): boolean {
  return REPORT_TYPES.has(ev.type)
}

function extractMd(ev: TaskEventData): string {
  try {
    const p = JSON.parse(ev.payload_json) as Record<string, unknown>
    if (typeof p.reportMd === 'string' && p.reportMd) return p.reportMd
    if (typeof p.report_md === 'string' && p.report_md) return p.report_md
    if (typeof p.message === 'string' && p.message) return p.message
  } catch { /* ignore */ }
  return ''
}
