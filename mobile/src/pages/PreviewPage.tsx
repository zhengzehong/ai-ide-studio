import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { wsClient } from '@desktop/services/ws-client'
import { useConnectionStore } from '../stores/connection.store'

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
  const location = useLocation()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [iframeKey, setIframeKey] = useState(0)

  const targetParam = new URLSearchParams(location.search).get('target')
  const effectiveTarget: 'pc' | 'app' | null =
    targetParam === 'pc' ? 'pc' : targetParam === 'app' ? 'app' : preview?.target ?? null
  const isLandscape = effectiveTarget === 'pc'
  const serverUrl = useConnectionStore(s => s.serverUrl)

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
    if (!Capacitor.isNativePlatform()) return
    if (effectiveTarget === 'pc') {
      void ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {})
    }
    return () => {
      if (Capacitor.isNativePlatform()) {
        void ScreenOrientation.unlock().catch(() => {})
      }
    }
  }, [effectiveTarget])

  const handleRefresh = () => setIframeKey(k => k + 1)

  return (
    <div style={styles.page}>
      {isLandscape ? (
        <div style={styles.floatContainer}>
          <button style={styles.floatBtn} onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <button
            style={{ ...styles.floatBtn, ...(!preview ? styles.disabledBtn : {}) }}
            onClick={handleRefresh}
            disabled={!preview}
            aria-label="刷新"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      ) : (
        <Header
          title={loading ? '加载中...' : preview?.title || '预览'}
          onBack={() => navigate(-1)}
          onRefresh={preview ? handleRefresh : undefined}
          isLandscape={false}
        />
      )}
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
          src={
            preview.url.startsWith('http')
              ? preview.url
              : `${serverUrl.replace(/\/$/, '')}${preview.url.startsWith('/') ? '' : '/'}${preview.url}`
          }
          style={styles.iframe}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </div>
  )
}

function Header({ title, onBack, onRefresh, isLandscape }: { title: string; onBack: () => void; onRefresh?: () => void; isLandscape: boolean }) {
  return (
    <div style={{ ...styles.header, ...(isLandscape ? styles.headerLandscape : styles.headerPortrait) }}>
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
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  headerPortrait: {
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
  },
  headerLandscape: {
    padding: '8px 12px',
    paddingLeft: 'calc(12px + env(safe-area-inset-left))',
    paddingRight: 'calc(12px + env(safe-area-inset-right))',
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
  floatContainer: {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top))',
    right: 'calc(8px + env(safe-area-inset-right))',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 100,
  },
  floatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    background: 'rgba(0, 0, 0, 0.4)',
    color: '#fff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
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
