import { Archive, ArrowLeft, BookOpen, RefreshCw, Search } from 'lucide-react'
import type { ReadingItem, ReadingProjectCount } from '../../types/reading'
import { ReadingCard } from './ReadingCard'

interface ReadingListPanelProps {
  items: ReadingItem[]
  loading: boolean
  error: string | null
  archived: boolean
  query: string
  projectId: string | null | undefined
  projectOptions: ReadingProjectCount[]
  selectedId: string | null
  onQueryChange: (query: string) => void
  onProjectChange: (projectId: string | null | undefined) => void
  onToggleArchive: () => void
  onRefresh: () => void
  onSelect: (item: ReadingItem) => void
  onStatus: (item: ReadingItem) => void
}

export function ReadingListPanel(props: ReadingListPanelProps) {
  return (
    <aside className="reading-list-panel">
      <header className="reading-list-header">
        <div className="reading-list-title-row">
          <h1>{props.archived ? '已归档' : '阅读'}</h1>
          <button type="button" className="reading-icon-button" onClick={props.onToggleArchive} title={props.archived ? '返回阅读列表' : '查看已归档'}>
            {props.archived ? <ArrowLeft size={17} /> : <Archive size={17} />}
          </button>
          <button type="button" className="reading-icon-button" onClick={props.onRefresh} title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="reading-filter-row">
          <label className="reading-search">
            <Search size={14} />
            <input
              aria-label="搜索阅读内容"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="搜索标题、摘要或来源会话"
            />
          </label>
          <select
            className="reading-project-select"
            aria-label="按项目筛选"
            value={props.projectId === null ? '__none__' : props.projectId ?? ''}
            onChange={(event) => props.onProjectChange(event.target.value === '' ? undefined : event.target.value === '__none__' ? null : event.target.value)}
          >
            <option value="">全部项目</option>
            {props.projectOptions.map((option) => (
              <option key={option.projectId ?? '__none__'} value={option.projectId ?? '__none__'}>
                {option.projectName || '未归类'} ({option.count})
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="reading-list-body">
        {props.loading && props.items.length === 0 && <ReadingListState icon="loading" text="正在加载阅读列表" />}
        {!props.loading && props.error && <ReadingListState icon="error" text={props.error} />}
        {!props.loading && !props.error && props.items.length === 0 && (
          <ReadingListState icon="empty" text={props.archived ? '还没有归档内容' : '没有待读内容'} />
        )}
        {props.items.map((item) => (
          <ReadingCard
            key={item.id}
            item={item}
            selected={props.selectedId === item.id}
            archived={props.archived}
            onOpen={props.onSelect}
            onStatus={props.onStatus}
          />
        ))}
      </div>
    </aside>
  )
}

function ReadingListState({ icon, text }: { icon: 'loading' | 'error' | 'empty'; text: string }) {
  return (
    <div className={`reading-list-state reading-list-state--${icon}`} role="status">
      <BookOpen size={30} />
      <span>{text}</span>
    </div>
  )
}
