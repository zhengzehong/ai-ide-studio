import { useEffect, useState } from 'react'
import { AlertCircle, Copy, FileText, Loader2, X } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import type { FilesPresentationInfo } from '../../stores/session-events'
import { wsClient } from '../../services/ws-client'
import { MarkdownRenderer } from '../MarkdownRenderer'

export function PresentedFilesModal({ presentation, onClose }: { presentation: FilesPresentationInfo; onClose: () => void }) {
  const [selectedPath, setSelectedPath] = useState(presentation.files[0]?.path ?? '')
  const [file, setFile] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (!selectedPath) return
    let active = true
    setLoading(true)
    setError(null)
    setFile(null)
    void wsClient.request({ type: 'fs.read', projectId: presentation.projectId, filePath: selectedPath })
      .then((value) => { if (active) setFile(value as FileContent) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '文件读取失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [presentation.projectId, selectedPath])

  const selected = presentation.files.find((item) => item.path === selectedPath) ?? presentation.files[0]
  const isMarkdown = file?.extension === '.md' || file?.extension === '.mdx'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(0,0,0,.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(1100px, 100%)', height: 'min(760px, calc(100vh - 48px))', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <header style={{ height: 48, padding: '0 12px 0 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presentation.title}</strong>
          {file && selected?.kind === 'text' && (
            <button type="button" title="复制内容" onClick={() => void navigator.clipboard.writeText(file.content)} style={iconButton}><Copy size={15} /></button>
          )}
          <button type="button" title="关闭" onClick={onClose} style={iconButton}><X size={16} /></button>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
          <nav style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 8, background: 'var(--bg-1)' }}>
            {presentation.files.map((item) => (
              <button key={item.path} type="button" onClick={() => setSelectedPath(item.path)} style={{ width: '100%', padding: '9px 10px', border: 'none', borderRadius: 6, background: item.path === selectedPath ? 'var(--primary-light)' : 'transparent', color: item.path === selectedPath ? 'var(--primary)' : 'var(--text-2)', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center' }}>
                <FileText size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
              </button>
            ))}
          </nav>
          <main style={{ minWidth: 0, overflow: 'auto', padding: 20 }}>
            {selected && <div style={{ marginBottom: 14, color: 'var(--text-3)', fontSize: 12 }}>{selected.path}</div>}
            {loading && <div style={stateStyle}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> 正在读取文件...</div>}
            {error && <div style={{ ...stateStyle, color: 'var(--red)' }}><AlertCircle size={20} /> {error}</div>}
            {!loading && !error && file?.truncated && <div style={{ marginBottom: 12, padding: 8, background: 'var(--yellow-light)', color: 'var(--yellow)', borderRadius: 6 }}>文件过大，仅显示前 1MB。</div>}
            {!loading && !error && file && selected?.kind === 'text' && (isMarkdown
              ? <MarkdownRenderer content={file.content} />
              : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6 }}>{file.content}</pre>)}
            {!loading && !error && file && selected?.kind !== 'text' && <div style={stateStyle}>该文件类型请在项目文件查看器中打开。</div>}
          </main>
        </div>
      </div>
    </div>
  )
}

const iconButton: React.CSSProperties = { width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }
const stateStyle: React.CSSProperties = { minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)' }
