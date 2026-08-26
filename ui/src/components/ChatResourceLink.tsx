import { useState, type ReactNode } from 'react'
import { AlertCircle, FileText, LoaderCircle } from 'lucide-react'
import type { OpenChatResource } from '../services/chat-resource-links'

export function ChatResourceLink({ reference, onOpen, children }: {
  reference: string
  onOpen: OpenChatResource
  children: ReactNode
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      await onOpen(reference)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文件或目录无法打开')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ display: 'inline' }}>
      <button
        type="button"
        onClick={() => void open()}
        title={error ? `${reference}\n${error}` : reference}
        aria-label={`打开项目资源：${reference}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
          border: 'none', background: 'transparent', color: error ? 'var(--red)' : 'var(--blue)',
          font: 'inherit', lineHeight: 'inherit', cursor: loading ? 'wait' : 'pointer', verticalAlign: 'baseline',
        }}
      >
        {loading ? <LoaderCircle size={13} style={{ animation: 'spin 1s linear infinite' }} /> : error ? <AlertCircle size={13} /> : <FileText size={13} />}
        <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</span>
      </button>
      {error && <span role="alert" style={{ marginLeft: 6, color: 'var(--red)', fontSize: 12 }}>{error}</span>}
    </span>
  )
}
