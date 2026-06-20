import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Bot, Check, Edit3, FileCode, Link as LinkIcon, Loader2, Save, X } from 'lucide-react'
import type { KnowledgeBacklinkData, KnowledgeLinkData, KnowledgePageReadData } from '../../stores/knowledge-base.store'
import type { PageFormState } from './page-form'
import { parseJsonStringArray, parseWikiHref, renderWikiMarkdown } from './wiki-link'

interface KnowledgeDocumentProps {
  read: KnowledgePageReadData | null
  pageLoading: boolean
  saving: boolean
  editing: boolean
  form: PageFormState
  onEdit: () => void
  onCancel: () => void
  onFormChange: (patch: Partial<PageFormState>) => void
  onSave: () => void
  onWikiLink: (link: KnowledgeLinkData) => void
  onBacklink: (link: KnowledgeBacklinkData) => void
  onRefreshByAgent: () => void
}

export function KnowledgeDocument({
  read,
  pageLoading,
  saving,
  editing,
  form,
  onEdit,
  onCancel,
  onFormChange,
  onSave,
  onWikiLink,
  onBacklink,
  onRefreshByAgent,
}: KnowledgeDocumentProps) {
  if (pageLoading && !read) return <main className="kb-doc kb-doc-empty">正在加载页面...</main>
  if (!read) return <main className="kb-doc kb-doc-empty">选择一个知识库页面</main>

  const page = read.page
  const tags = parseJsonStringArray(page.tags_json)
  const srcFiles = parseJsonStringArray(page.src_files_json)
  const markdown = renderWikiMarkdown(page.body, read.outLinks)

  return (
    <main className="kb-doc">
      <div className="kb-doc-toolbar">
        <div className="kb-doc-title-wrap">
          <div className="kb-eyebrow">{read.kb.name}</div>
          <h1>{page.title}</h1>
        </div>
        <div className="kb-doc-actions">
          {editing ? (
            <>
              <button className="kb-secondary-btn" type="button" onClick={onCancel}>
                <X size={14} />取消
              </button>
              <button className="kb-primary-btn" type="button" onClick={onSave} disabled={saving || !form.title.trim() || !form.body.trim()}>
                {saving ? <Loader2 className="kb-spin" size={14} /> : <Save size={14} />}
                {saving ? '保存中' : '保存'}
              </button>
            </>
          ) : (
            <button className="kb-secondary-btn" type="button" onClick={onEdit}>
              <Edit3 size={14} />编辑
            </button>
          )}
        </div>
      </div>

      {page.stale ? (
        <div className="kb-stale-banner">
          <FileCode size={16} />
          <span>源文件已变化，这个代码知识页需要刷新。</span>
          <button type="button" onClick={onRefreshByAgent}>
            <Bot size={14} />让 AI 刷新
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="kb-edit-form">
          <input value={form.title} onChange={(event) => onFormChange({ title: event.target.value })} placeholder="页面标题" />
          <div className="kb-edit-grid">
            <input value={form.section} onChange={(event) => onFormChange({ section: event.target.value })} placeholder="分组" />
            <input value={form.tags} onChange={(event) => onFormChange({ tags: event.target.value })} placeholder="标签，用逗号分隔" />
          </div>
          <input value={form.summary} onChange={(event) => onFormChange({ summary: event.target.value })} placeholder="摘要" />
          <textarea value={form.body} onChange={(event) => onFormChange({ body: event.target.value })} className="kb-body-editor" placeholder="Markdown 正文，支持 [[页面标题]]" />
          {read.kb.src === 'code' && (
            <textarea value={form.srcFiles} onChange={(event) => onFormChange({ srcFiles: event.target.value })} className="kb-source-editor" placeholder="源文件路径，每行一个" />
          )}
        </div>
      ) : (
        <>
          <div className="kb-doc-meta">
            <span>{page.section || '未分组'}</span>
            <span>{page.author === 'human' ? '人工维护' : 'AI 维护'}</span>
            <span>{formatDateTime(page.updated_at)}</span>
            {tags.map((tag) => <span key={tag}>#{tag}</span>)}
          </div>

          {page.summary && <p className="kb-summary">{page.summary}</p>}

          <div className="kb-markdown markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={{
                a: ({ href, children }) => {
                  const parsed = parseWikiHref(href)
                  if (!parsed) return <a href={href || '#'} target="_blank" rel="noreferrer">{children}</a>
                  const link = read.outLinks.find((item) => item.text === parsed.text)
                  return (
                    <button
                      className={`kb-wikilink kb-wikilink--${parsed.status}`}
                      type="button"
                      onClick={() => {
                        if (link) onWikiLink(link)
                      }}
                    >
                      {children}
                    </button>
                  )
                },
                table: ({ children }) => (
                  <div className="markdown-table-scroll">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>

          {srcFiles.length > 0 && (
            <div className="kb-source-list">
              <div className="kb-section-title"><FileCode size={14} />源文件</div>
              {srcFiles.map((file) => <code key={file}>{file}</code>)}
            </div>
          )}

          <div className="kb-link-block">
            <div className="kb-section-title"><LinkIcon size={14} />反向链接</div>
            {read.backlinks.length === 0 ? (
              <div className="kb-muted">暂无反向链接</div>
            ) : (
              read.backlinks.map((link) => (
                <button key={`${link.kbId}:${link.pageId}`} type="button" onClick={() => onBacklink(link)}>
                  {link.title}
                </button>
              ))
            )}
          </div>

          <div className="kb-link-block">
            <div className="kb-section-title"><Check size={14} />出链</div>
            {read.outLinks.length === 0 ? (
              <div className="kb-muted">暂无出链</div>
            ) : (
              read.outLinks.map((link) => (
                <button key={link.text} type="button" onClick={() => onWikiLink(link)}>
                  {link.text}<span>{link.status}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </main>
  )
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}
