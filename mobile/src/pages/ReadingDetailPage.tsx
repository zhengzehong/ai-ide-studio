import { Archive, ArrowLeft, ExternalLink, Loader2, MessageSquareMore } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { absoluteReadingUrl } from '@desktop/services/reading-client'
import { useReadingStore } from '@desktop/stores/reading.store'
import type { ReadingItem } from '@desktop/types/reading'
import { useConnectionStore } from '../stores/connection.store'
import { useAppStore } from '../stores/app.store'
import { useSessionStore } from '../stores/session.store'
import { syncActivityProject } from './ActivityPage'
import { MobileReadingContent } from '../components/reading/MobileReadingContent'

export default function ReadingDetailPage() {
  const { readingId = '' } = useParams<{ readingId: string }>()
  const navigate = useNavigate()
  const serverUrl = useConnectionStore((state) => state.serverUrl)
  const getItem = useReadingStore((state) => state.get)
  const updateStatus = useReadingStore((state) => state.updateStatus)
  const setCurrentProject = useAppStore((state) => state.setCurrentProject)
  const fetchAgents = useAppStore((state) => state.fetchAgents)
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const [item, setItem] = useState<ReadingItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [markdownLoading, setMarkdownLoading] = useState(false)
  const [markdownError, setMarkdownError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void getItem(readingId).then(async (loaded) => {
      const next = loaded.status === 'unread' ? await updateStatus(loaded.id, 'read') : loaded
      if (active) setItem(next)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '阅读内容加载失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [getItem, readingId, updateStatus])

  useEffect(() => {
    if (!item || item.format !== 'md' || !item.contentUrl) return
    const controller = new AbortController()
    const url = absoluteReadingUrl(item.contentUrl, serverUrl)
    setMarkdownLoading(true)
    setMarkdownError(null)
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? '源文件不存在' : 'Markdown 加载失败')
        setMarkdown(await response.text())
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setMarkdownError(reason instanceof Error ? reason.message : 'Markdown 加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setMarkdownLoading(false)
      })
    return () => controller.abort()
  }, [item, serverUrl])

  const returnToSession = (): void => {
    if (!item?.projectId || !item.sessionId) return
    void syncActivityProject(item.projectId, { setCurrentProject, fetchAgents, fetchSessions })
    navigate(`/chat/${item.sessionId}`, { state: { returnTo: '/reading' } })
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <button type="button" className="pressable" style={styles.iconButton} onClick={() => navigate('/reading')} aria-label="返回阅读列表"><ArrowLeft size={21} /></button>
        <div style={styles.heading}>
          <strong style={styles.title}>{item?.title || (loading ? '加载中' : '阅读')}</strong>
          {item && <span style={styles.source}>{[item.projectName || '未归类', item.agentName].filter(Boolean).join(' · ')}</span>}
        </div>
        {item?.format === 'url' && item.externalUrl && (
          <button type="button" className="pressable" style={styles.iconButton} onClick={() => void openReadingExternalUrl(item.externalUrl!)} aria-label="在浏览器打开"><ExternalLink size={19} /></button>
        )}
      </header>

      <main style={styles.content}>
        {loading && <div style={styles.state}><Loader2 size={24} className="spin" />正在加载</div>}
        {!loading && error && <div style={{ ...styles.state, color: 'var(--error)' }}>{error}</div>}
        {!loading && item && (
          <MobileReadingContent
            item={item}
            serverUrl={serverUrl}
            markdown={markdown}
            markdownLoading={markdownLoading}
            markdownError={markdownError}
            onOpenExternal={(url) => void openReadingExternalUrl(url)}
          />
        )}
      </main>

      {item && (
        <footer style={styles.actions}>
          <button type="button" className="pressable" style={styles.secondaryAction} onClick={() => void updateStatus(item.id, 'archived').then(() => navigate('/reading'))}>
            <Archive size={16} />归档
          </button>
          <button type="button" className="pressable" style={{ ...styles.primaryAction, ...(!item.projectId || !item.sessionId ? styles.disabled : {}) }} disabled={!item.projectId || !item.sessionId} onClick={returnToSession}>
            <MessageSquareMore size={16} />回到会话
          </button>
        </footer>
      )}
    </div>
  )
}

export async function openReadingExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-card)' },
  header: { minHeight: 58, display: 'flex', alignItems: 'center', gap: 9, padding: 'calc(8px + var(--safe-top)) 10px 8px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-card)', flexShrink: 0 },
  iconButton: { width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--bg-input)', color: 'var(--text-primary)', flexShrink: 0 },
  heading: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 },
  title: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: 15 },
  source: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 11 },
  content: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' },
  state: { flex: 1, minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 13 },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '10px 12px calc(10px + var(--safe-bottom))', borderTop: '1px solid var(--border-light)', background: 'rgba(255,255,255,.94)', flexShrink: 0 },
  secondaryAction: { height: 38, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 14px', borderRadius: 19, background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 },
  primaryAction: { height: 38, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 16px', borderRadius: 19, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600 },
  disabled: { opacity: .45 },
}
