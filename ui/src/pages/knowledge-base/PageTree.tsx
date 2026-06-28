import { FileText, Search, Sparkles } from 'lucide-react'
import type { KnowledgePageData } from '../../stores/knowledge-base.store'

interface PageTreeProps {
  pages: KnowledgePageData[]
  searchResults: KnowledgePageData[]
  currentPageId: string | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onSelect: (pageId: string) => void
  onCreate: () => void
}

export function PageTree({
  pages,
  searchResults,
  currentPageId,
  searchQuery,
  onSearchChange,
  onSelect,
  onCreate,
}: PageTreeProps) {
  const visiblePages = searchQuery.trim() ? searchResults : pages

  return (
    <aside className="kb-page-tree">
      <div className="kb-panel-header kb-panel-header--compact">
        <div>
          <div className="kb-eyebrow">页面</div>
          <h2>{pages.length}</h2>
        </div>
        <button className="kb-secondary-btn" type="button" onClick={onCreate}>
          新建
        </button>
      </div>

      <label className="kb-search">
        <Search size={14} />
        <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索标题或正文" />
      </label>

      <div className="kb-page-list">
        {visiblePages.length === 0 ? (
          <div className="kb-empty-mini">没有页面</div>
        ) : (
          visiblePages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`kb-page-item${page.id === currentPageId ? ' is-active' : ''}`}
              onClick={() => onSelect(page.id)}
            >
              <span className="kb-page-icon">
                {page.is_index ? <Sparkles size={14} /> : <FileText size={14} />}
              </span>
              <span className="kb-page-main">
                <strong>{page.title}</strong>
                <small>{page.section || '未分组'}{page.stale ? ' · 陈旧' : ''}</small>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
