import { Loader2, FileText } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { SessionTemplateData } from '@desktop/stores/session.store'
import { formatTime } from './NewSessionSheet.utils'

interface Props {
  templates: SessionTemplateData[]
  loading: boolean
  error: string | null
  instantiatingId: string | null
  onPick: (template: SessionTemplateData) => void
}

export default function TemplateList({
  templates,
  loading,
  error,
  instantiatingId,
  onPick,
}: Props) {
  return (
    <div style={styles.list}>
      {loading && (
        <div style={styles.loading}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          <span>加载模板...</span>
        </div>
      )}
      {!loading && error && <div style={styles.error}>{error}</div>}
      {!loading && !error && templates.length === 0 && (
        <div style={styles.empty}>
          <FileText size={36} color="var(--text-muted)" strokeWidth={1.2} />
          <span style={styles.emptyText}>该 Agent 暂无会话模板</span>
        </div>
      )}
      {!loading && !error && templates.length > 0 && (
        templates.map((template) => (
          <button
            key={template.id}
            style={{
              ...styles.item,
              opacity: instantiatingId !== null && instantiatingId !== template.id ? 0.5 : 1,
            }}
            onClick={() => onPick(template)}
            disabled={instantiatingId !== null}
          >
            <div style={styles.body}>
              <div style={styles.name}>{template.name}</div>
              {template.description && <div style={styles.desc}>{template.description}</div>}
              <div style={styles.meta}>
                <span>使用 {template.use_count} 次</span>
                {template.last_used_at && <span>· 上次 {formatTime(template.last_used_at)}</span>}
              </div>
            </div>
            {instantiatingId === template.id && (
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            )}
          </button>
        ))
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    background: 'var(--bg)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '28px 0',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  empty: {
    padding: '40px 0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-muted)',
  },
  emptyText: { fontSize: 14 },
  error: {
    margin: '12px 16px',
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(250,81,81,0.08)',
    color: 'var(--error)',
    fontSize: 13,
  },
  item: {
    width: '100%',
    padding: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    borderBottom: '1px solid var(--border-light)',
  },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' },
  desc: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 4,
    display: 'flex',
    gap: 4,
  },
}
