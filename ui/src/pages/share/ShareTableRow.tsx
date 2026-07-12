import { type CSSProperties } from 'react'
import { Copy, Check, RefreshCw, Ban, Trash2 } from 'lucide-react'
import type { ShareRow } from '../../services/share-api'
import type { AgentData } from '../../stores/agent.store'
import type { SessionData } from '../../stores/session.store'
import { computeStatus, formatExpiresAt, formatLastVisited, type ShareStatus } from './share-format'

interface ShareRowItemProps {
  share: ShareRow
  agents: AgentData[]
  sessions: SessionData[]
  nowTick: number
  copiedId: string | null
  onCopy: (share: ShareRow) => void
  onAction: (kind: 'revoke' | 'renew' | 'delete' | 'regen') => void
}

export function ShareTableRow({ share, agents, sessions, nowTick, copiedId, onCopy, onAction }: ShareRowItemProps) {
  const status = computeStatus(share, nowTick)
  const session = sessions.find((s) => s.id === share.session_id)
  const agent = agents.find((a) => a.id === share.agent_id)
  const sessionTitle = session?.title?.trim() || share.session_id.slice(0, 8)
  const agentName = agent?.name ?? share.agent_id.slice(0, 8)
  const isCopied = copiedId === share.id

  return (
    <tr style={rowStyles.row}>
      <td style={rowStyles.tdName}>{share.share_name}</td>
      <td style={rowStyles.td}>{sessionTitle}</td>
      <td style={rowStyles.td}>{agentName}</td>
      <td style={rowStyles.td}>{formatExpiresAt(share.expires_at)}</td>
      <td style={rowStyles.td}><StatusTag status={status} /></td>
      <td style={rowStyles.tdCount}>{share.visit_count}</td>
      <td style={rowStyles.td}>{formatLastVisited(share.last_visited_at)}</td>
      <td style={rowStyles.tdActions}>
        {status === 'active' && (
          <>
            <ActionLink onClick={() => onCopy(share)} title="复制链接">
              {isCopied ? <Check size={12} color="var(--green)" /> : <Copy size={12} />}
              {isCopied ? '已复制' : '复制链接'}
            </ActionLink>
            <ActionLink onClick={() => onAction('renew')} title="续期 7 天">
              <RefreshCw size={12} /> 续期
            </ActionLink>
            <ActionLink danger onClick={() => onAction('revoke')} title="撤销">
              <Ban size={12} /> 撤销
            </ActionLink>
          </>
        )}
        {status === 'expired' && (
          <>
            <ActionLink onClick={() => onAction('regen')} title="重新生成">
              <RefreshCw size={12} /> 重新生成
            </ActionLink>
            <ActionLink danger onClick={() => onAction('delete')} title="删除">
              <Trash2 size={12} /> 删除
            </ActionLink>
          </>
        )}
        {status === 'revoked' && (
          <ActionLink danger onClick={() => onAction('delete')} title="删除">
            <Trash2 size={12} /> 删除
          </ActionLink>
        )}
      </td>
    </tr>
  )
}

function StatusTag({ status }: { status: ShareStatus }) {
  if (status === 'active') return <span style={{ ...rowStyles.statusTag, ...rowStyles.statusActive }}>生效中</span>
  if (status === 'expired') return <span style={{ ...rowStyles.statusTag, ...rowStyles.statusExpired }}>已过期</span>
  return <span style={{ ...rowStyles.statusTag, ...rowStyles.statusRevoked }}>已撤销</span>
}

function ActionLink({ children, onClick, danger, title }: { children: React.ReactNode; onClick: () => void; danger?: boolean; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        ...rowStyles.actionLink,
        color: danger ? 'var(--red)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  )
}

const rowStyles: Record<string, CSSProperties> = {
  row: { borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 12px', color: 'var(--text-2)', fontSize: 13 },
  tdName: { padding: '11px 12px', color: 'var(--text-1)', fontWeight: 500, fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  tdCount: { padding: '11px 12px', color: 'var(--text-2)', fontSize: 13, textAlign: 'center' as const },
  tdActions: { padding: '8px 12px', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' as const },
  actionLink: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 5, border: 'none', background: 'transparent', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  statusTag: { display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 },
  statusActive: { background: 'rgba(34,197,94,0.12)', color: '#16a34a' },
  statusExpired: { background: 'rgba(239,68,68,0.12)', color: '#dc2626' },
  statusRevoked: { background: 'var(--bg-2)', color: 'var(--text-3)' },
}
