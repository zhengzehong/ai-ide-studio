import { useEffect, useMemo, useState } from 'react'
import { PanelRightClose } from 'lucide-react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import type { FilesPresentationInfo, MessageData, PreviewPresentationInfo } from '../stores/session-events'
import { wsClient } from '../services/ws-client'
import './updates/updates-content.css'
import './updates/updates-preview-tabs.css'

interface UpdatesPreviewPanelProps { messages: MessageData[]; projectId: string | null; sessionId: string | null; collapsed: boolean; onToggle: () => void }
type FileContent = { key: string; content: string; extension: string; kind: string; truncated: boolean }
type SideView = 'reply' | 'preview' | string

export function UpdatesPreviewPanel({ messages, projectId, sessionId, collapsed, onToggle }: UpdatesPreviewPanelProps) {
  const presentations = useMemo(() => messages.filter((message) => message.role === 'agent').flatMap((message) => message.parsedPresentations ?? []).reverse(), [messages])
  const previews = presentations.filter((item): item is PreviewPresentationInfo => item.kind === 'preview')
  const files = presentations.filter((item): item is FilesPresentationInfo => item.kind === 'files')
  const [view, setView] = useState<SideView>('reply')
  const [viewSessionId, setViewSessionId] = useState<string | null>(sessionId)
  if (viewSessionId !== sessionId) {
    setViewSessionId(sessionId)
    setView('reply')
  }
  const [fileContent, setFileContent] = useState<FileContent | null>(null)
  const presentedFiles = files.flatMap((presentation) => presentation.files.map((file) => ({ presentation, file, key: `${presentation.presentationId}:${file.path}` })))
  const selectedPresented = presentedFiles.find((item) => item.key === view) ?? null
  const selectedProjectId = selectedPresented?.presentation.projectId || projectId
  const selectedPath = selectedPresented?.file.path
  const reply = latestReply(messages)

  useEffect(() => {
    if (!selectedPath) return
    let active = true
    void wsClient.request({ type: 'fs.read', projectId: selectedProjectId, filePath: selectedPath })
      .then((value) => { if (active) setFileContent({ key: view, ...(value as Omit<FileContent, 'key'>) }) })
      .catch(() => { if (active) setFileContent({ key: view, content: '', extension: '', kind: 'error', truncated: false }) })
    return () => { active = false }
  }, [view, selectedPath, selectedProjectId])

  if (collapsed) return <button type="button" className="wb-preview-collapsed" onClick={onToggle} title="展开面板"><PanelRightClose size={16} /><span>面板</span></button>
  return (
    <aside className="wb-preview" aria-label="会话内容面板">
      <header className="wb-side-head">
        <div className="wb-chips" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'reply'} className={`wb-fchip${view === 'reply' ? ' is-on' : ''}`} onClick={() => setView('reply')}>最后回复</button>
          {previews.length > 0 && (
            <button type="button" role="tab" aria-selected={view === 'preview'} className={`wb-fchip${view === 'preview' ? ' is-on' : ''}`} onClick={() => setView('preview')}>预览 {previews.length}</button>
          )}
          {presentedFiles.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.key}
              data-file-key={item.key}
              aria-selected={view === item.key}
              title={item.file.path}
              className={`wb-fchip mono${view === item.key ? ' is-on' : ''}`}
              onClick={() => setView(item.key)}
            >
              {item.file.title || item.file.path.split('/').pop()}
            </button>
          ))}
        </div>
        <button type="button" className="wb-side-collapse" onClick={onToggle} title="收起面板" aria-label="收起面板"><PanelRightClose size={16} /></button>
      </header>
      <div className="wb-side-body">
        {view === 'reply' && (reply
          ? <section className="wb-doc"><MarkdownRenderer content={reply} /></section>
          : <div className="wb-side-empty">当前会话还没有最终回复<br /><small>Agent 输出长报告或文件时,会出现在这里全宽查看</small></div>)}
        {view === 'preview' && previews.map((preview) => (
          <div key={preview.previewId} className="wb-preview-block">
            <div className="wb-preview-block-title"><span>{preview.title}</span><small>{preview.target.toUpperCase()}</small></div>
            <iframe title={preview.title} src={preview.url} sandbox="allow-scripts allow-same-origin" />
          </div>
        ))}
        {selectedPresented && view !== 'reply' && view !== 'preview' && (
          <FileContentView
            path={selectedPresented.file.path}
            content={fileContent?.key === view ? fileContent : null}
            loading={!fileContent || fileContent.key !== view}
          />
        )}
        {view !== 'reply' && view !== 'preview' && !selectedPresented && <div className="wb-side-empty">该文件不存在</div>}
      </div>
    </aside>
  )
}

function latestReply(messages: MessageData[]): string { const message = messages.filter((item) => item.role === 'agent').at(-1); return message?.finalAnswer ?? message?.content ?? '' }

function FileContentView({ path, content, loading }: { path: string; content: FileContent | null; loading: boolean }) {
  if (loading) return <div className="wb-side-empty">正在读取文件...</div>
  if (!content || content.kind === 'error') return <div className="wb-side-empty">文件读取失败</div>
  if (content.kind !== 'text') return <div className="wb-side-empty">该文件类型暂不支持内嵌预览</div>
  const markdown = ['.md', '.mdx'].includes(content.extension.toLowerCase())
  const html = ['.html', '.htm'].includes(content.extension.toLowerCase())
  return (
    <section className="wb-fileview-wrap">
      {content.truncated && <div className="wb-truncated">文件较大，仅显示部分内容</div>}
      <div className="wb-fileview-path">{path}</div>
      {markdown
        ? <div className="wb-doc"><MarkdownRenderer content={content.content} /></div>
        : html
          ? <iframe className="wb-html-preview" title="HTML 文件预览" srcDoc={content.content} sandbox="allow-scripts" />
          : <pre className="wb-fileview">{content.content}</pre>}
    </section>
  )
}
