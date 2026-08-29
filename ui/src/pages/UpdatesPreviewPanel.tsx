import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FileText, Files, PanelRightClose, RefreshCw } from 'lucide-react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import type { FilesPresentationInfo, MessageData, PreviewPresentationInfo } from '../stores/session-events'
import { wsClient } from '../services/ws-client'
import './updates/updates-content.css'
import './updates/updates-preview-tabs.css'

interface UpdatesPreviewPanelProps { messages: MessageData[]; projectId: string | null; collapsed: boolean; onToggle: () => void }
type FileContent = { key: string; content: string; extension: string; kind: string; truncated: boolean }

export function UpdatesPreviewPanel({ messages, projectId, collapsed, onToggle }: UpdatesPreviewPanelProps) {
  const presentations = useMemo(() => messages.filter((message) => message.role === 'agent').flatMap((message) => message.parsedPresentations ?? []).reverse(), [messages])
  const previews = presentations.filter((item): item is PreviewPresentationInfo => item.kind === 'preview')
  const files = presentations.filter((item): item is FilesPresentationInfo => item.kind === 'files')
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [viewOverride, setViewOverride] = useState<'reply' | 'artifacts' | null>(null)
  const [fileContent, setFileContent] = useState<FileContent | null>(null)
  const presentedFiles = files.flatMap((presentation) => presentation.files.map((file) => ({ presentation, path: file.path, key: `${presentation.presentationId}:${file.path}` })))
  const selectedFile = presentedFiles.find((file) => file.key === selectedFileKey) ?? presentedFiles[0] ?? null
  const selectedKey = selectedFile?.key ?? null
  const selectedProjectId = selectedFile?.presentation.projectId || projectId
  const selectedPath = selectedFile?.path
  const reply = latestReply(messages)
  const activeView = viewOverride ?? (presentations.length > 0 ? 'artifacts' : 'reply')

  useEffect(() => {
    if (!selectedKey || !selectedPath) return
    let active = true
    void wsClient.request({ type: 'fs.read', projectId: selectedProjectId, filePath: selectedPath })
      .then((value) => { if (active) setFileContent({ key: selectedKey, ...(value as Omit<FileContent, 'key'>) }) })
      .catch(() => { if (active) setFileContent({ key: selectedKey, content: '', extension: '', kind: 'error', truncated: false }) })
    return () => { active = false }
  }, [selectedKey, selectedPath, selectedProjectId])

  if (collapsed) return <button type="button" className="workbench-preview-collapsed" onClick={onToggle} title="展开预览"><ChevronRight size={16} /><span>预览</span></button>
  return (
    <aside className="workbench-preview" aria-label="会话预览">
      <header className="workbench-preview-header"><div><strong>会话预览</strong><span>{presentations.length > 0 ? `${presentations.length} 个产物` : '最后回复与文件'}</span></div><button type="button" className="workbench-icon-button" onClick={onToggle} title="收起预览" aria-label="收起预览"><PanelRightClose size={16} /></button></header>
      <div className="workbench-preview-tabs"><button type="button" className={activeView === 'reply' ? 'is-selected' : ''} onClick={() => setViewOverride('reply')}>最后回复</button><button type="button" className={activeView === 'artifacts' ? 'is-selected' : ''} onClick={() => setViewOverride('artifacts')}>产物 {presentations.length}</button></div>
      <div className="workbench-preview-scroll">
        {activeView === 'reply' && reply && <section className="workbench-last-reply"><div className="workbench-preview-block-title"><span>最后回复</span><RefreshCw size={13} /></div><MarkdownRenderer content={reply} /></section>}
        {activeView === 'reply' && !reply && <div className="workbench-preview-empty">当前会话还没有最终回复</div>}
        {activeView === 'artifacts' && previews.map((preview) => <div key={preview.previewId} className="workbench-preview-block"><div className="workbench-preview-block-title"><span>{preview.title}</span><small>{preview.target.toUpperCase()}</small></div><iframe title={preview.title} src={preview.url} sandbox="allow-scripts allow-same-origin" /></div>)}
        {activeView === 'artifacts' && files.map((presentation) => <section key={presentation.presentationId} className="workbench-files-block"><div className="workbench-preview-block-title"><Files size={14} /><span>{presentation.title}</span></div><div className="workbench-file-tabs">{presentation.files.map((file) => { const fileKey = `${presentation.presentationId}:${file.path}`; return <button type="button" key={fileKey} data-file-key={fileKey} className={selectedKey === fileKey ? 'is-selected' : ''} onClick={() => setSelectedFileKey(fileKey)}><FileText size={12} />{file.title}</button> })}</div></section>)}
        {activeView === 'artifacts' && selectedFile && <FileContentView content={fileContent?.key === selectedKey ? fileContent : null} loading={!fileContent || fileContent.key !== selectedKey} />}
        {activeView === 'artifacts' && !presentations.length && <div className="workbench-preview-empty">当前会话还没有文件或原型产物</div>}
      </div>
    </aside>
  )
}

function latestReply(messages: MessageData[]): string { const message = messages.filter((item) => item.role === 'agent').at(-1); return message?.finalAnswer ?? message?.content ?? '' }
function FileContentView({ content, loading }: { content: FileContent | null; loading: boolean }) {
  if (loading) return <div className="workbench-preview-empty">正在读取文件...</div>
  if (!content || content.kind === 'error') return <div className="workbench-preview-empty">文件读取失败</div>
  if (content.kind !== 'text') return <div className="workbench-preview-empty">该文件类型暂不支持内嵌预览</div>
  const markdown = ['.md', '.mdx'].includes(content.extension.toLowerCase())
  const html = ['.html', '.htm'].includes(content.extension.toLowerCase())
  return <section className="workbench-file-content">{content.truncated && <div className="workbench-truncated">文件较大，仅显示部分内容</div>}{markdown ? <MarkdownRenderer content={content.content} /> : html ? <iframe className="workbench-html-preview" title="HTML 文件预览" srcDoc={content.content} sandbox="allow-scripts" /> : <pre>{content.content}</pre>}</section>
}
