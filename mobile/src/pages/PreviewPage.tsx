import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { wsClient } from '@desktop/services/ws-client'

interface PreviewData {
  id: string
  title: string
  target: 'pc' | 'app'
  url: string
  task_id: string | null
  created_at: string
}

export default function PreviewPage() {
  const { previewId = '' } = useParams<{ previewId: string }>()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [iframeKey, setIframeKey] = useState(0)

  useEffect(() => {
    if (!previewId) return
    setLoading(true)
    setError(null)
    wsClient
      .request({ type: 'previews.get', previewId })
      .then((data) => {
        const payload = data as { preview?: PreviewData }
        const item = payload?.preview
        if (!item) { setError('预览不存在'); setLoading(false); return }
        setPreview(item)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载失败')
        setLoading(false)
      })
  }, [previewId])

  useEffect(() => {
    if (!preview || !Capacitor.isNativePlatform()) return
    if (preview.target === 'pc') {
      void ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {})
    }
    return () => {
      if (Capacitor.isNativePlatform()) {
        void ScreenOrientation.unlock().catch(() => {})
      }
    }
  }, [preview?.target])

  const handleRefresh = () => setIframeKey(k => k + 1)

  return (
    <div style={styles.page}>
      <Header
        title={loading ? '加载中...' : preview?.title || '预览'}
        onBack={() => navigate(-1)}
        onRefresh={preview ? handleRefresh : undefined}
      />
      {loading && (
        <div style={styles.empty}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
          <span style={styles.emptyText}>加载中...</span>
        </div>
      )}
      {!loading && (error || !preview) && (
        <div style={styles.empty}>
          <AlertCircle size={36} color="var(--text-muted)" />
          <span style={styles.emptyText}>{error || '预览不存在'}</span>
        </div>
      )}
      {!loading && preview && (
        <iframe
          key={iframeKey}
          src={preview.url}
          style={styles.iframe}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </div>
  )
}

function Header({ title, onBack, onRefresh }: { title: string; onBack: () => void; onRefresh?: () => void }) {
  return (
    <div style={styles.header}>
      <button style={styles.iconBtn} onClick={onBack} aria-label="返回">
        <ArrowLeft size={20} />
      </button>
      <span style={styles.headerTitle}>{title}</span>
      <button
        style={{ ...styles.iconBtn, ...(!onRefresh ? styles.disabledBtn : {}) }}
        onClick={onRefresh}
        disabled={!onRefresh}
        aria-label="刷新"
      >
        <RefreshCw size={18} />
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#fff',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--text-primary)',
    flexShrink: 0,
  },
  disabledBtn: {
    opacity: 0.4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  iframe: {
    flex: 1,
    width: '100%',
    height: '100%',
    border: 'none',
    background: '#fff',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    color: 'var(--text-muted)',
    padding: 32,
    minHeight: 200,
  },
  emptyText: {
    fontSize: 13,
    color: 'var(--text-muted)',
  },
}
