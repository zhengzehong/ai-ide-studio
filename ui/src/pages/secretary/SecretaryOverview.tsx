import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  MonitorUp,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { SecretaryData, SecretaryRunData, SecretaryRunStatus } from '../../stores/secretary.store'

interface SecretaryOverviewProps {
  secretary: SecretaryData
  executionAgentName: string
  runs: SecretaryRunData[]
  runsLoading: boolean
  onOpenRuntime: () => void
  onOpenChat: () => void
}

const STATUS: Record<SecretaryRunStatus, { label: string; color: string }> = {
  pending: { label: '排队中', color: 'var(--text-3)' },
  running: { label: '执行中', color: 'var(--blue)' },
  succeeded: { label: '已完成', color: 'var(--green)' },
  failed: { label: '失败', color: 'var(--red)' },
}

export function SecretaryOverview({
  secretary,
  executionAgentName,
  runs,
  runsLoading,
  onOpenRuntime,
  onOpenChat,
}: SecretaryOverviewProps) {
  const cron = secretary.triggers.find((trigger) => trigger.type === 'cron' && trigger.enabled)?.cron
  return (
    <div style={styles.page}>
      <section style={styles.identity}>
        <span style={styles.avatar}><Bot size={20} /></span>
        <div style={styles.identityCopy}>
          <div style={styles.nameLine}>
            <h2 style={styles.name}>{secretary.name}</h2>
            <span style={{ ...styles.state, ...(secretary.enabled ? styles.stateOn : {}) }}>
              {secretary.enabled ? '运行中' : '已停用'}
            </span>
          </div>
          <p style={styles.description}>{secretary.definitionPrompt || '尚未填写秘书职责'}</p>
        </div>
      </section>

      <dl style={styles.facts}>
        <Fact label="执行 Agent" value={executionAgentName} />
        <Fact label="观察范围" value={secretary.observeAll ? '全部 Agent' : `${secretary.observedAgentIds.length} 个 Agent`} />
        <Fact label="定时规则" value={cron || '未设置'} />
        <Fact label="最近运行" value={secretary.lastRunAt ? formatTime(secretary.lastRunAt) : '尚未运行'} />
      </dl>

      <section style={styles.section}>
        <header style={styles.sectionHeader}><div style={styles.sectionHeading}><strong>关联会话</strong><span>完整过程在工作空间中查看</span></div></header>
        <div style={styles.sessionRows}>
          <button type="button" disabled={!secretary.runtimeSessionId} onClick={onOpenRuntime} style={styles.sessionRow}>
            <MonitorUp size={17} /><span style={styles.sessionCopy}><strong>后台执行会话</strong><small>查看定时和事件触发的完整执行过程</small></span><b>打开</b>
          </button>
          <button type="button" disabled={!secretary.chatSessionId} onClick={onOpenChat} style={styles.sessionRow}>
            <MessageSquare size={17} /><span style={styles.sessionCopy}><strong>秘书对话</strong><small>向秘书追问、确认或安排后续事项</small></span><b>打开</b>
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <header style={styles.sectionHeader}><div style={styles.sectionHeading}><strong>最近执行</strong><span>保留最近 20 条运行记录</span></div></header>
        {runsLoading ? <div style={styles.empty}><Loader2 size={16} className="spin" /> 正在同步执行记录</div>
          : runs.length === 0 ? <div style={styles.empty}>秘书尚未产生执行记录</div>
            : <div style={styles.runs}>{runs.map((run) => <RunRow key={run.id} run={run} onOpen={onOpenRuntime} />)}</div>}
      </section>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div style={styles.fact}><dt style={styles.factLabel}>{label}</dt><dd style={styles.factValue}>{value}</dd></div>
}

function RunRow({ run, onOpen }: { run: SecretaryRunData; onOpen: () => void }) {
  const status = STATUS[run.status]
  return (
    <div style={styles.run}>
      <span style={{ ...styles.runIcon, color: status.color }}>{statusIcon(run.status)}</span>
      <div style={styles.runCopy}>
        <div style={styles.runTitle}><strong style={{ color: status.color }}>{status.label}</strong><span>{eventLabel(run.eventType)}</span><time>{formatTime(run.createdAt)}</time></div>
        <small>{run.error || durationLabel(run.elapsedMs)}</small>
      </div>
      <button type="button" onClick={onOpen} style={styles.openRun}>查看会话</button>
    </div>
  )
}

function statusIcon(status: SecretaryRunStatus) {
  if (status === 'running') return <Loader2 size={15} className="spin" />
  if (status === 'succeeded') return <CheckCircle2 size={15} />
  if (status === 'failed') return <AlertCircle size={15} />
  return <Clock3 size={15} />
}

function eventLabel(value: string): string {
  if (value === 'cron') return '定时触发'
  if (value === 'manual') return '手动触发'
  if (value === 'session:committed_done') return '会话完成触发'
  if (value === 'task:update') return '任务状态触发'
  return value
}

function durationLabel(value: number | null): string {
  if (value == null) return '等待开始'
  if (value < 1000) return '不到 1 秒'
  const seconds = Math.floor(value / 1000)
  if (seconds < 60) return `耗时 ${seconds} 秒`
  return `耗时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const styles: Record<string, CSSProperties> = {
  page: { minWidth: 0, overflowY: 'auto', padding: '20px 22px 28px', color: 'var(--text-2)' },
  identity: { display: 'flex', alignItems: 'flex-start', gap: 12, paddingBottom: 18, borderBottom: '1px solid var(--border)' },
  avatar: { width: 42, height: 42, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'var(--blue-light)', color: 'var(--blue)' },
  identityCopy: { minWidth: 0, flex: 1 }, nameLine: { display: 'flex', alignItems: 'center', gap: 8 },
  name: { margin: 0, fontSize: 18, color: 'var(--text-1)' },
  state: { padding: '2px 6px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 10 },
  stateOn: { background: 'color-mix(in srgb, var(--green) 10%, var(--bg-0))', color: 'var(--green)' },
  description: { margin: '6px 0 0', color: 'var(--text-3)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  facts: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 0, margin: 0, padding: '14px 0', borderBottom: '1px solid var(--border)' },
  fact: { minWidth: 0, padding: '0 13px', borderRight: '1px solid var(--border-light)' },
  factLabel: { color: 'var(--text-3)', fontSize: 10 }, factValue: { margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12 },
  section: { paddingTop: 18 }, sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionHeading: { display: 'flex', alignItems: 'baseline', gap: 8, color: 'var(--text-2)', fontSize: 12 },
  sessionRows: { borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' },
  sessionRow: { width: '100%', minHeight: 52, display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', alignItems: 'center', gap: 8, padding: '8px 9px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-2)', textAlign: 'left', cursor: 'pointer' },
  sessionCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  runs: { borderTop: '1px solid var(--border)' }, run: { minHeight: 48, display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto', alignItems: 'center', gap: 7, borderBottom: '1px solid var(--border-light)' },
  runIcon: { display: 'inline-flex' }, runCopy: { minWidth: 0 }, runTitle: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 },
  openRun: { border: 0, background: 'transparent', color: 'var(--blue)', cursor: 'pointer', fontSize: 11 },
  empty: { minHeight: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-3)', fontSize: 12, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' },
}
