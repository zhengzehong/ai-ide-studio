import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ReadingItem } from '@desktop/types/reading'
import { absoluteReadingUrl } from '@desktop/services/reading-client'
import MarkdownView from '../MarkdownView'

interface MobileReadingContentProps {
  item: ReadingItem
  serverUrl: string
  markdown: string
  markdownLoading: boolean
  markdownError: string | null
  onOpenExternal: (url: string) => void
}

export function MobileReadingContent({ item, serverUrl, markdown, markdownLoading, markdownError, onOpenExternal }: MobileReadingContentProps) {
  if (item.format === 'md') {
    if (markdownLoading) return <ContentState icon="loading" text="正在加载正文" />
    if (markdownError) return <ContentState icon="error" text={markdownError} />
    const assetBaseUrl = item.contentUrl ? absoluteReadingUrl(item.contentUrl, serverUrl) : ''
    return <article style={styles.article}><MarkdownView content={markdown} assetBaseUrl={assetBaseUrl} /></article>
  }
  if (item.format === 'html' && item.contentUrl) {
    return (
      <iframe
        title={item.title}
        src={absoluteReadingUrl(item.contentUrl, serverUrl)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        style={styles.iframe}
      />
    )
  }
  if (item.format === 'url' && item.externalUrl) {
    return (
      <div style={styles.urlWrap}>
        <div style={styles.notice}>
          <span>网站可能禁止嵌入</span>
          <button type="button" className="pressable" style={styles.external} onClick={() => onOpenExternal(item.externalUrl!)}>
            <ExternalLink size={14} />浏览器打开
          </button>
        </div>
        <iframe
          title={item.title}
          src={item.externalUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={styles.iframe}
        />
      </div>
    )
  }
  return <ContentState icon="error" text="阅读内容不可用" />
}

function ContentState({ icon, text }: { icon: 'loading' | 'error'; text: string }) {
  return (
    <div style={styles.state}>
      {icon === 'loading' ? <Loader2 size={24} className="spin" /> : <AlertCircle size={28} />}
      <span>{text}</span>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  article: { minHeight: '100%', padding: '22px 22px 100px', background: 'var(--bg-card)', fontSize: 16, lineHeight: 1.85 },
  iframe: { flex: 1, width: '100%', height: '100%', border: 0, background: '#fff' },
  urlWrap: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  notice: { minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 12px', borderBottom: '1px solid var(--border-light)', background: 'var(--warning-bg)', color: 'var(--text-secondary)', fontSize: 12 },
  external: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 15, background: 'var(--bg-card)', color: 'var(--primary)', fontSize: 12, fontWeight: 600 },
  state: { flex: 1, minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 },
}
