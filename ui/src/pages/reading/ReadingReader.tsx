import { Archive, BookOpen, ExternalLink, Loader2, MessageSquareMore } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReadingItem } from '../../types/reading'
import { ReadingMarkdown } from './ReadingMarkdown'

interface ReadingReaderProps {
  item: ReadingItem | null
  onArchive: (item: ReadingItem) => void
  onReturn: (item: ReadingItem) => void
  onOpenExternal: (url: string) => void
}

export function ReadingReader(props: ReadingReaderProps) {
  const [markdownState, setMarkdownState] = useState<{
    readingId: string | null
    markdown: string
    error: string | null
  }>({ readingId: null, markdown: '', error: null })

  useEffect(() => {
    const item = props.item
    if (!item || item.format !== 'md' || !item.contentUrl) return
    const controller = new AbortController()
    void fetch(item.contentUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? '源文件不存在' : 'Markdown 加载失败')
        setMarkdownState({ readingId: item.id, markdown: await response.text(), error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setMarkdownState({
          readingId: item.id,
          markdown: '',
          error: error instanceof Error ? error.message : 'Markdown 加载失败',
        })
      })
    return () => controller.abort()
  }, [props.item])

  const markdownMatches = props.item?.format === 'md' && markdownState.readingId === props.item.id
  return (
    <ReadingReaderContent
      {...props}
      markdown={markdownMatches ? markdownState.markdown : ''}
      markdownLoading={props.item?.format === 'md' && !markdownMatches}
      markdownError={markdownMatches ? markdownState.error : null}
    />
  )
}

interface ReadingReaderContentProps extends ReadingReaderProps {
  item: ReadingItem | null
  markdown: string
  markdownLoading: boolean
  markdownError: string | null
}

export function ReadingReaderContent({ item, markdown, markdownLoading, markdownError, onArchive, onReturn, onOpenExternal }: ReadingReaderContentProps) {
  if (!item) {
    return (
      <main className="reading-reader reading-reader--empty">
        <BookOpen size={42} />
        <strong>选择一篇内容开始阅读</strong>
      </main>
    )
  }
  return (
    <main className="reading-reader">
      <header className="reading-toolbar">
        <div className="reading-source">
          <strong>{item.title}</strong>
          <span>{[item.projectName || '未归类', item.agentName, item.sessionTitle].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="reading-toolbar-actions">
          {item.format === 'url' && item.externalUrl && (
            <button type="button" className="reading-toolbar-button" onClick={() => onOpenExternal(item.externalUrl!)}>
              <ExternalLink size={15} />在浏览器打开
            </button>
          )}
          <button type="button" className="reading-toolbar-button" onClick={() => onArchive(item)}>
            <Archive size={15} />归档
          </button>
          <button
            type="button"
            className="reading-toolbar-button reading-toolbar-button--primary"
            disabled={!item.projectId || !item.sessionId}
            onClick={() => onReturn(item)}
          >
            <MessageSquareMore size={15} />回到会话
          </button>
        </div>
      </header>
      <div className={`reading-content reading-content--${item.format}`}>
        {item.format === 'md' && markdownLoading && <div className="reading-content-state"><Loader2 className="spin" size={22} />正在加载正文</div>}
        {item.format === 'md' && markdownError && <div className="reading-content-state reading-content-state--error">{markdownError}</div>}
        {item.format === 'md' && !markdownLoading && !markdownError && item.contentUrl && (
          <article className="reading-article"><ReadingMarkdown content={markdown} assetBaseUrl={item.contentUrl} /></article>
        )}
        {item.format === 'html' && item.contentUrl && (
          <iframe title={item.title} src={item.contentUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
        {item.format === 'url' && item.externalUrl && (
          <>
            <div className="reading-url-notice">部分网站可能禁止嵌入，可使用“在浏览器打开”继续访问。</div>
            <iframe title={item.title} src={item.externalUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
          </>
        )}
      </div>
    </main>
  )
}
