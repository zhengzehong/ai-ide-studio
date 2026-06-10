import { type CSSProperties } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import type { PermissionRequestInfo } from '@desktop/stores/session-events'

interface Props {
  request: PermissionRequestInfo
  onRespond: (optionId?: string, cancelled?: boolean) => void
}

export default function PermissionCard({ request, onRespond }: Props) {
  if (request.resolved) return null

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <ShieldAlert size={18} color="var(--warning)" />
        <span style={styles.title}>权限请求</span>
      </div>

      <div style={styles.toolName}>{request.toolCall?.title || '工具调用'}</div>

      {request.toolCall?.content?.map((item, i) => (
        item.path && <div key={i} style={styles.filePath}>{item.path}</div>
      ))}

      <div style={styles.actions}>
        {request.options.map(opt => (
          <button
            key={opt.optionId}
            style={opt.kind === 'allow' ? styles.allowBtn : styles.denyBtn}
            onClick={() => onRespond(opt.optionId)}
          >
            {opt.name}
          </button>
        ))}
        <button style={styles.cancelBtn} onClick={() => onRespond(undefined, true)}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    margin: '8px 16px',
    padding: 14,
    borderRadius: 'var(--radius)',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  toolName: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  },
  filePath: {
    fontSize: 12,
    color: 'var(--info)',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 10,
  },
  allowBtn: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--success)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
  },
  denyBtn: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
    color: 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: 500,
  },
  cancelBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
  },
}
