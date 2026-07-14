import { useEffect, useState } from 'react'
import { ModalOverlay } from '../../components/ModalDialog'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useAgentMemoryStore, type AgentMemoryEntrySummary } from '../../stores/agent-memory.store'

interface EntryModalProps {
  open: boolean
  mode: 'create' | 'edit'
  entry: AgentMemoryEntrySummary | null
  projectId: string | null
  agentId: string | null
  saving: boolean
  onSave: (input: { title: string; content: string; tags: string[] }) => Promise<void>
  onClose: () => void
}

export function EntryModal({ open, mode, entry, projectId, agentId, saving, onSave, onClose }: EntryModalProps) {
  const getEntry = useAgentMemoryStore((s) => s.getEntry)
  const initialTitle = entry?.title ?? ''
  const initialTags = entry?.tags.join(', ') ?? ''
  const [title, setTitle] = useState(initialTitle)
  const [content, setContent] = useState('')
  const [tagsText, setTagsText] = useState(initialTags)
  const [showPreview, setShowPreview] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)

  useEffect(() => {
    if (!open || mode !== 'edit' || !entry || !projectId || !agentId) return
    let cancelled = false
    setLoadingContent(true)
    getEntry(projectId, agentId, entry.id)
      .then((full) => {
        if (!cancelled) setContent(full.content)
      })
      .catch(() => {
        // ignore; user can retry by closing/reopening
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, mode, entry, projectId, agentId, getEntry])

  useEffect(() => {
    if (!open) return
    setTitle(entry?.title ?? '')
    setTagsText(entry?.tags.join(', ') ?? '')
    setContent('')
    setShowPreview(false)
  }, [open, entry])

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean)
    await onSave({ title: title.trim(), content, tags })
  }

  return (
    <ModalOverlay open={open} onClose={onClose} title={mode === 'edit' ? '编辑条目' : '新建条目'} width={640}>
      <div className="am-modal-field">
        <label>标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="am-modal-field">
        <label>
          内容(Markdown,长条目用 ## 标题 / 列表 / ```代码块``` 结构化)
          <span style={{ float: 'right', fontWeight: 400 }}>
            <a className="am-toggle-link" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? '编辑' : '预览'}
            </a>
          </span>
        </label>
        {loadingContent ? (
          <div style={{ minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 6 }}>
            加载中...
          </div>
        ) : showPreview ? (
          <div className="am-entry-full" style={{ minHeight: 180, border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <textarea
            style={{ minHeight: 180, fontFamily: 'Menlo, Consolas, monospace' }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="短条目可直接写一句,长条目用 MD 结构化"
          />
        )}
        <div className="am-md-hint">提示: 长条目用 ## 标题、- 列表、```代码块``` 结构化</div>
      </div>
      <div className="am-modal-field">
        <label>标签(逗号分隔)</label>
        <input type="text" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="tag1, tag2" />
      </div>
      <div className="am-modal-actions">
        <button type="button" className="am-btn" onClick={onClose}>取消</button>
        <button
          type="button"
          className="am-btn am-btn-primary"
          onClick={handleSave}
          disabled={saving || loadingContent || !title.trim() || !content.trim()}
        >
          保存
        </button>
      </div>
    </ModalOverlay>
  )
}
