import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { wsClient } from '@desktop/services/ws-client'
import type { FilesPresentationInfo } from '@desktop/stores/session-events'
import type { FileContent } from '../../stores/filesystem.store'
import { FileDetail } from './FileDetail'

export function PresentedFilesOverlay({
  presentation,
  onClose,
}: {
  presentation: FilesPresentationInfo
  onClose: () => void
}) {
  const [selectedPath, setSelectedPath] = useState(presentation.files[0]?.path ?? '')
  const [file, setFile] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = presentation.files.find((item) => item.path === selectedPath) ?? presentation.files[0]

  useEffect(() => {
    if (!selected) return
    let active = true
    setLoading(true)
    setError(null)
    setFile(null)
    void wsClient.request({ type: 'fs.read', projectId: presentation.projectId, filePath: selected.path })
      .then((value) => {
        if (!active) return
        const content = value as Omit<FileContent, 'kind'> & { kind?: FileContent['kind'] }
        setFile({ ...content, kind: content.kind ?? selected.kind })
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '文件读取失败')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [presentation.projectId, selected])

  const displayFile: FileContent = file ?? {
    path: selected?.path ?? '', content: '', size: selected?.size ?? 0,
    extension: selected?.extension ?? '', language: selected?.language ?? 'plaintext',
    truncated: false, kind: selected?.kind ?? 'text',
  }

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={presentation.title}>
      <header style={styles.header}>
        <strong style={styles.title}>{presentation.title}</strong>
        <button style={styles.closeButton} onClick={onClose} aria-label="关闭"><X size={20} /></button>
      </header>
      <nav style={styles.selector} aria-label="选择文件">
        {presentation.files.map((item) => (
          <button
            key={item.path}
            style={{ ...styles.fileButton, ...(item.path === selectedPath ? styles.fileButtonActive : {}) }}
            onClick={() => setSelectedPath(item.path)}
          >
            {item.title}
          </button>
        ))}
      </nav>
      <div style={styles.content}>
        <FileDetail file={displayFile} loading={loading} error={error} onBack={onClose} embedded />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: { minHeight: 48, padding: '8px 10px 8px 16px', paddingTop: 'calc(8px + var(--safe-top))', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card)' },
  title: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 16 },
  closeButton: { width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-primary)' },
  selector: { display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 12px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card)', flexShrink: 0 },
  fileButton: { flex: '0 0 auto', maxWidth: 180, padding: '7px 10px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 },
  fileButtonActive: { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--primary-light)' },
  content: { minHeight: 0, flex: 1 },
}
