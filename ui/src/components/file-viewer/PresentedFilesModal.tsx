import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, FileText, Loader2, X } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import type { FilesPresentationInfo } from '../../stores/session-events'
import { wsClient } from '../../services/ws-client'
import { MarkdownRenderer } from '../MarkdownRenderer'

export function PresentedFilesModal({ presentation, onClose }: { presentation: FilesPresentationInfo; onClose: () => void }) {
  const [selectedPath, setSelectedPath] = useState(presentation.files[0]?.path ?? '')
  const [loadResult, setLoadResult] = useState<{
    path: string
    file: FileContent | null
    error: string | null
  } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    if (!selectedPath) return
    let active = true
    void wsClient.request({ type: 'fs.read', projectId: presentation.projectId, filePath: selectedPath })
      .then((value) => {
        if (active) setLoadResult({ path: selectedPath, file: value as FileContent, error: null })
      })
      .catch((reason: unknown) => {
        if (active) setLoadResult({ path: selectedPath, file: null, error: reason instanceof Error ? reason.message : '文件读取失败' })
      })
    return () => { active = false }
  }, [presentation.projectId, selectedPath])

  const selected = presentation.files.find((item) => item.path === selectedPath) ?? presentation.files[0]
  const loading = loadResult?.path !== selectedPath
  const file = loadResult?.path === selectedPath ? loadResult.file : null
  const error = loadResult?.path === selectedPath ? loadResult.error : null
  const isMarkdown = file?.extension === '.md' || file?.extension === '.mdx'
  const canCopy = !!file && selected?.kind === 'text'

  const copyContent = async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(file.content)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), 1500)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1600, width: '100vw', height: '100dvh', background: 'var(--bg-0)', display: 'flex' }}>
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ height: 52, padding: '0 14px 0 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presentation.title}</strong>
          <button
            type="button"
            aria-label="复制内容"
            title={copyState === 'failed' ? '复制失败' : '复制内容'}
            disabled={!canCopy}
            onClick={() => void copyContent()}
            style={{ ...actionButton, opacity: canCopy ? 1 : 0.4 }}
          >
            {copyState === 'copied'
              ? <Check size={15} color="var(--green)" />
              : copyState === 'failed'
                ? <AlertCircle size={15} color="var(--red)" />
                : <Copy size={15} />}
            <span>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}</span>
          </button>
          <button type="button" aria-label="关闭" title="关闭" onClick={onClose} style={iconButton}><X size={16} /></button>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', minHeight: 0, flex: 1 }}>
          <nav style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 8, background: 'var(--bg-1)' }}>
            {presentation.files.map((item) => (
              <button key={item.path} type="button" onClick={() => setSelectedPath(item.path)} style={{ width: '100%', padding: '9px 10px', border: 'none', borderRadius: 6, background: item.path === selectedPath ? 'var(--primary-light)' : 'transparent', color: item.path === selectedPath ? 'var(--primary)' : 'var(--text-2)', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center' }}>
                <FileText size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
              </button>
            ))}
          </nav>
          <main style={{ minWidth: 0, overflow: 'auto', padding: 24 }}>
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
const actionButton: React.CSSProperties = { height: 30, padding: '0 9px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, border: 'none', borderRadius: 6, background: 'var(--bg-2)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 }
const stateStyle: React.CSSProperties = { minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)' }
