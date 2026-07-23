import { FileText, Files } from 'lucide-react'
import type { FilesPresentationInfo } from '../../stores/session-events'

export function FilesPresentationCard({
  presentation,
  onOpen,
}: {
  presentation: FilesPresentationInfo
  onOpen: (presentation: FilesPresentationInfo) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(presentation)}
      style={{
        width: '100%', marginTop: 10, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
        background: 'var(--bg-1)', border: '1px solid var(--border)', borderLeft: '3px solid var(--primary)',
        borderRadius: 8, color: 'var(--text-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Files size={16} color="var(--primary)" />
        <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {presentation.title}
        </strong>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{presentation.files.length} 个文件</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {presentation.files.slice(0, 3).map((file) => (
          <span key={file.path} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)' }}>
            <FileText size={12} /> {file.title}
          </span>
        ))}
        {presentation.files.length > 3 && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>还有 {presentation.files.length - 3} 个文件</span>
        )}
      </div>
    </button>
  )
}
