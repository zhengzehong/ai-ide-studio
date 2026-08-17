import { AlertCircle, CheckCircle2, Clock3, Loader2, MessageSquare, MonitorUp } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { SecretaryRunData, SecretaryRunStatus } from '@desktop/stores/secretary.store'
import type { MobileSecretary } from '../stores/secretary.store'

interface Props {
  secretary: MobileSecretary
  runs: SecretaryRunData[]
  loading: boolean
  onOpenRuntime: () => void
  onOpenChat: () => void
}

export function SecretaryOverview({ secretary, runs, loading, onOpenRuntime, onOpenChat }: Props) {
  return (
    <section style={styles.section} aria-label="秘书运行概览">
      <div style={styles.sessionLinks}>
        <button type="button" disabled={!secretary.runtimeSessionId} onClick={onOpenRuntime} style={styles.sessionLink}>
          <MonitorUp size={17} /><span style={styles.sessionCopy}><strong>后台执行会话</strong><small>查看完整执行过程</small></span>
        </button>
        <button type="button" disabled={!secretary.chatSessionId} onClick={onOpenChat} style={styles.sessionLink}>
          <MessageSquare size={17} /><span style={styles.sessionCopy}><strong>秘书对话</strong><small>追问或安排事项</small></span>
        </button>
      </div>
      <div style={styles.heading}><strong>最近执行</strong><span>{runs.length > 0 ? `${runs.length} 条` : ''}</span></div>
      {loading ? <div style={styles.empty}><Loader2 size={15} /> 正在同步</div>
        : runs.length === 0 ? <div style={styles.empty}>尚无执行记录</div>
          : runs.slice(0, 5).map((run) => <RunRow key={run.id} run={run} onOpen={onOpenRuntime} />)}
    </section>
  )
}

function RunRow({ run, onOpen }: { run: SecretaryRunData; onOpen: () => void }) {
  const meta = statusMeta(run.status)
  return (
    <button type="button" onClick={onOpen} style={styles.run}>
      <span style={{ color: meta.color }}>{meta.icon}</span>
      <span style={styles.runCopy}><strong style={{ color: meta.color }}>{meta.label} · {eventLabel(run.eventType)}</strong><small>{run.error || formatRunMeta(run)}</small></span>
      <time>{formatTime(run.createdAt)}</time>
    </button>
  )
}

function statusMeta(status: SecretaryRunStatus) {
  if (status === 'running') return { label: '执行中', color: 'var(--primary)', icon: <Loader2 size={14} /> }
  if (status === 'succeeded') return { label: '已完成', color: 'var(--success)', icon: <CheckCircle2 size={14} /> }
  if (status === 'failed') return { label: '失败', color: 'var(--error)', icon: <AlertCircle size={14} /> }
  return { label: '排队中', color: 'var(--text-muted)', icon: <Clock3 size={14} /> }
}

function eventLabel(value: string): string {
  if (value === 'cron') return '定时'
  if (value === 'manual') return '手动'
  if (value === 'session:committed_done') return '会话完成'
  if (value === 'task:update') return '任务状态'
  return value
}

function formatRunMeta(run: SecretaryRunData): string {
  if (run.elapsedMs == null) return '等待开始'
  return run.elapsedMs < 60_000 ? `耗时 ${Math.max(1, Math.floor(run.elapsedMs / 1000))} 秒` : `耗时 ${Math.floor(run.elapsedMs / 60_000)} 分钟`
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const styles: Record<string, CSSProperties> = {
  section: { background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  sessionLinks: { display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border-light)' },
  sessionLink: { minWidth: 0, minHeight: 54, display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', alignItems: 'center', gap: 7, padding: '8px 12px', border: 0, borderRight: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-primary)', textAlign: 'left' },
  sessionCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  heading: { height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 13px', color: 'var(--text-secondary)', fontSize: 12 },
  run: { width: '100%', minHeight: 45, display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', alignItems: 'center', gap: 6, padding: '7px 13px', border: 0, borderTop: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-secondary)', textAlign: 'left' },
  runCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  empty: { minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12, borderTop: '1px solid var(--border-light)' },
}
