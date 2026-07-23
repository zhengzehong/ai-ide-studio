import { FileText, Files } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { FilesPresentationInfo } from '@desktop/stores/session-events'

export function FilesPresentationCard({
  presentation,
  onOpen,
}: {
  presentation: FilesPresentationInfo
  onOpen: (presentation: FilesPresentationInfo) => void
}) {
  return (
    <button style={styles.card} onClick={() => onOpen(presentation)}>
      <div style={styles.header}>
        <Files size={16} color="var(--primary)" />
        <strong style={styles.title}>{presentation.title}</strong>
        <span style={styles.count}>{presentation.files.length} 个文件</span>
      </div>
      <div style={styles.list}>
        {presentation.files.slice(0, 3).map((file) => (
          <span key={file.path} style={styles.file}>
            <FileText size={12} />
            <span style={styles.fileTitle}>{file.title}</span>
          </span>
        ))}
        {presentation.files.length > 3 && (
          <span style={styles.more}>还有 {presentation.files.length - 3} 个文件</span>
        )}
      </div>
      <span style={styles.action}>点击查看</span>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: 'block', width: '100%', marginTop: 8, padding: '11px 12px', textAlign: 'left',
    background: 'var(--bg-card)', border: '1px solid var(--border-light)',
    borderLeft: '3px solid var(--primary)', borderRadius: 8, cursor: 'pointer',
  },
  header: { display: 'flex', alignItems: 'center', gap: 7 },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: 'var(--text-primary)' },
  count: { flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' },
  list: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 },
  file: { display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)', fontSize: 12 },
  fileTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  more: { color: 'var(--text-muted)', fontSize: 11 },
  action: { display: 'block', marginTop: 8, textAlign: 'right', color: 'var(--primary)', fontSize: 12, fontWeight: 500 },
}
