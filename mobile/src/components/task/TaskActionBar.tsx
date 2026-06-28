import { type CSSProperties } from 'react'
import { MessageSquare, Play, Check, X, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import type { TaskStatus } from '../../../../src/types/ws-protocol'

interface Props {
  status: TaskStatus
  agentReportStatus: string | null
  hasSession: boolean
  onOpenSession: () => void
  onApprove: () => void
  onAccept: () => void
  onReject: () => void
  onCancel: () => void
  onStart: () => void
  onReopen: () => void
  onDelete: () => void
  busy?: boolean
}

export default function TaskActionBar({
  status,
  agentReportStatus,
  hasSession,
  onOpenSession,
  onApprove,
  onAccept,
  onReject,
  onCancel,
  onStart,
  onReopen,
  onDelete,
  busy = false,
}: Props) {
  const isReviewing = status === 'needs_input' && agentReportStatus === 'done'

  return (
    <div style={styles.bar}>
      {hasSession && (
        <button style={{ ...styles.btn, ...styles.secondaryBtn }} onClick={onOpenSession} disabled={busy}>
          <MessageSquare size={15} />
          <span>打开会话</span>
        </button>
      )}

      {status === 'needs_input' && !isReviewing && (
        <>
          <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onApprove} disabled={busy}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
            <span>批准继续</span>
          </button>
          <button style={{ ...styles.btn, ...styles.dangerGhostBtn }} onClick={onReject} disabled={busy}>
            <X size={15} />
            <span>驳回</span>
          </button>
        </>
      )}

      {isReviewing && (
        <>
          <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onAccept} disabled={busy}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
            <span>验收通过</span>
          </button>
          <button style={{ ...styles.btn, ...styles.dangerGhostBtn }} onClick={onReject} disabled={busy}>
            <X size={15} />
            <span>驳回</span>
          </button>
        </>
      )}

      {status === 'executing' && (
        <button style={{ ...styles.btn, ...styles.dangerGhostBtn }} onClick={onCancel} disabled={busy}>
          <X size={15} />
          <span>取消</span>
        </button>
      )}

      {status === 'backlog' && (
        <>
          <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onStart} disabled={busy}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={15} />}
            <span>启动</span>
          </button>
          <button style={{ ...styles.btn, ...styles.dangerGhostBtn }} onClick={onDelete} disabled={busy}>
            <Trash2 size={15} />
            <span>删除</span>
          </button>
        </>
      )}

      {(status === 'completed' || status === 'cancelled') && (
        <>
          <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onReopen} disabled={busy}>
            {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={15} />}
            <span>重新打开</span>
          </button>
          <button style={{ ...styles.btn, ...styles.dangerGhostBtn }} onClick={onDelete} disabled={busy}>
            <Trash2 size={15} />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  bar: {
    display: 'flex',
    gap: 8,
    padding: '10px 16px calc(10px + var(--safe-bottom))',
    background: 'var(--bg-card)',
    borderTop: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  btn: {
    flex: 1,
    height: 40,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
    border: '1px solid transparent',
  },
  primaryBtn: {
    background: 'var(--primary)',
    color: '#fff',
  },
  secondaryBtn: {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-light)',
  },
  dangerGhostBtn: {
    background: 'transparent',
    color: 'var(--error)',
    border: '1px solid var(--error)',
  },
}
