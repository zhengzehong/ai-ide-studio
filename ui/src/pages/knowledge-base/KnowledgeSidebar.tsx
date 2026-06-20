import { BookOpen, Code2, Library, Link2, Plus, Unlink } from 'lucide-react'
import type { KnowledgeBaseData } from '../../stores/knowledge-base.store'

interface KnowledgeSidebarProps {
  knowledgeBases: KnowledgeBaseData[]
  sharedKnowledgeBases: KnowledgeBaseData[]
  currentKbId: string | null
  onSelect: (kbId: string) => void
  onCreate: () => void
  onMount: (kbId: string) => void
  onUnmount: (kbId: string) => void
}

export function KnowledgeSidebar({
  knowledgeBases,
  sharedKnowledgeBases,
  currentKbId,
  onSelect,
  onCreate,
  onMount,
  onUnmount,
}: KnowledgeSidebarProps) {
  const mountedIds = new Set(knowledgeBases.map((kb) => kb.id))
  const mountable = sharedKnowledgeBases.filter((kb) => !mountedIds.has(kb.id))

  return (
    <aside className="kb-sidebar">
      <div className="kb-panel-header">
        <div>
          <div className="kb-eyebrow">知识库</div>
          <h2>LLM Wiki</h2>
        </div>
        <button className="kb-icon-btn" type="button" onClick={onCreate} title="新建知识库">
          <Plus size={16} />
        </button>
      </div>

      <div className="kb-list">
        {knowledgeBases.map((kb) => (
          <button
            key={kb.id}
            type="button"
            className={`kb-list-item${kb.id === currentKbId ? ' is-active' : ''}`}
            onClick={() => onSelect(kb.id)}
          >
            <span className="kb-list-icon">{kb.src === 'code' ? <Code2 size={16} /> : <BookOpen size={16} />}</span>
            <span className="kb-list-main">
              <strong>{kb.name}</strong>
              <small>{kb.kind === 'project' ? '项目库' : '共享库'} · {kb.src === 'code' ? '代码' : '手动'}</small>
            </span>
            {kb.kind === 'shared' && (
              <span
                className="kb-inline-action"
                role="button"
                tabIndex={0}
                title="卸载共享库"
                onClick={(event) => {
                  event.stopPropagation()
                  onUnmount(kb.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  onUnmount(kb.id)
                }}
              >
                <Unlink size={13} />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="kb-mount-box">
        <div className="kb-section-title">
          <Library size={14} />
          可挂载共享库
        </div>
        {mountable.length === 0 ? (
          <div className="kb-muted">暂无可挂载的共享库</div>
        ) : (
          mountable.map((kb) => (
            <button key={kb.id} className="kb-mount-item" type="button" onClick={() => onMount(kb.id)}>
              <Link2 size={13} />
              <span>{kb.name}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
