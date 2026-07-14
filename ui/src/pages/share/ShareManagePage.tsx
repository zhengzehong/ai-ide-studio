import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share2, Plus, AlertTriangle, RefreshCw, ChevronLeft } from 'lucide-react'
import { useShareStore } from '../../stores/share.store'
import { useAgentStore } from '../../stores/agent.store'
import { useSessionStore } from '../../stores/session.store'
import { ShareModal } from './ShareModal'
import { ShareTableRow } from './ShareTableRow'
import { EmptyState, SkeletonRows } from './ShareTableEmpty'
import { ConfirmDialog } from './ShareConfirmDialog'
import type { ShareRow } from '../../services/share-api'

type ConfirmKind = 'revoke' | 'renew' | 'delete' | 'regen'

export default function ShareManagePage() {
  const navigate = useNavigate()
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const shares = useShareStore((s) => s.shares)
  const loading = useShareStore((s) => s.loading)
  const error = useShareStore((s) => s.error)
  const fetchShares = useShareStore((s) => s.fetchShares)
  const revokeShare = useShareStore((s) => s.revokeShare)
  const renewShare = useShareStore((s) => s.renewShare)
  const deleteShare = useShareStore((s) => s.deleteShare)
  const createShare = useShareStore((s) => s.createShare)
  const clearError = useShareStore((s) => s.clearError)

  const [nowTick, setNowTick] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ kind: ConfirmKind; share: ShareRow } | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const ownerAgentId = useMemo(() => {
    if (agents.length === 0) return ''
    const primaryAgent = agents.find((a) => a.status !== 'standby' && !a.hidden_at) ?? agents[0]
    return primaryAgent?.id ?? ''
  }, [agents])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (ownerAgentId) void fetchShares(ownerAgentId)
  }, [ownerAgentId, fetchShares])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleCopy = async (share: ShareRow) => {
    const url = `${window.location.origin}/share/${share.share_token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(share.id)
      setToast('链接已复制')
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch {
      setToast('复制失败,请手动复制')
    }
  }

  const handleConfirm = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    if (action.kind === 'revoke') {
      const ok = await revokeShare(action.share.id, action.share.owner_agent_id)
      setToast(ok ? '已撤销' : '撤销失败')
    } else if (action.kind === 'renew') {
      const ok = await renewShare(action.share.id, 7, action.share.owner_agent_id)
      setToast(ok ? '已续期 7 天' : '续期失败')
    } else if (action.kind === 'delete') {
      const ok = await deleteShare(action.share.id, action.share.owner_agent_id)
      setToast(ok ? '已删除' : '删除失败')
    } else if (action.kind === 'regen') {
      const oldShare = action.share
      const session = sessions.find((s) => s.id === oldShare.session_id)
      if (!session) {
        setToast('找不到原会话,无法重新生成')
        return
      }
      const newShare = await createShare({
        sessionId: oldShare.session_id,
        ownerAgentId: oldShare.owner_agent_id,
        shareName: oldShare.share_name,
        agentIntro: oldShare.agent_intro,
        permission: oldShare.permission,
        toolCallVisibility: oldShare.tool_call_visibility,
        expiresAt: oldShare.expires_at,
      })
      if (newShare) {
        await deleteShare(oldShare.id, oldShare.owner_agent_id)
        setToast('已重新生成,旧链接已失效')
      } else {
        setToast('重新生成失败')
      }
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button type="button" onClick={() => navigate('/settings')} style={styles.backBtn}>
          <ChevronLeft size={14} /> 设置
        </button>
        <div style={styles.headerTitle}>
          <Share2 size={18} color="var(--blue)" />
          <span>我的分享</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          style={styles.createBtn}
          disabled={!ownerAgentId}
        >
          <Plus size={14} /> 新建分享
        </button>
      </div>

      {error && (
        <div style={styles.errorBar}>
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => { clearError(); if (ownerAgentId) void fetchShares(ownerAgentId) }} style={styles.retryBtn}>
            <RefreshCw size={12} /> 重试
          </button>
        </div>
      )}

      <div style={styles.tableWrap}>
        {loading && shares.length === 0 ? (
          <SkeletonRows />
        ) : shares.length === 0 ? (
          <EmptyState onCreate={() => setShowCreateModal(true)} disabled={!ownerAgentId} />
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>分享名字</th>
                <th style={styles.th}>会话</th>
                <th style={styles.th}>Agent</th>
                <th style={styles.th}>有效期</th>
                <th style={styles.th}>状态</th>
                <th style={styles.th}>访问次数</th>
                <th style={styles.th}>最后访问</th>
                <th style={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <ShareTableRow
                  key={share.id}
                  share={share}
                  agents={agents}
                  sessions={sessions}
                  nowTick={nowTick}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  onAction={(kind) => setConfirmAction({ kind, share })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
        />
      )}

      {showCreateModal && (
        <ShareModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          ownerAgentId={ownerAgentId}
          agentName={agents.find((a) => a.id === ownerAgentId)?.name ?? 'Agent'}
        />
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '20px 28px', background: 'var(--bg-1)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0 },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600, color: 'var(--text-1)', flex: 1 },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  errorBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'var(--red-light, #fef2f2)', color: 'var(--red)', fontSize: 13, marginBottom: 12, flexShrink: 0 },
  retryBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 12, cursor: 'pointer' },
  tableWrap: { flex: 1, overflow: 'auto', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, minHeight: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-3)', fontSize: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg-1)', position: 'sticky' as const, top: 0, zIndex: 1 },
  toast: { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 8, background: 'var(--text-1)', color: 'var(--bg-0)', fontSize: 13, fontWeight: 500, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' },
}
