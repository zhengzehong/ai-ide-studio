import { ArrowLeft, Loader2, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSessionDockStore } from '../../stores/session-dock.store'
import { sessionDockTitle } from './session-dock-format'

export function SessionDockPicker() {
  const candidates = useSessionDockStore((state) => state.candidates)
  const searching = useSessionDockStore((state) => state.searching)
  const searchError = useSessionDockStore((state) => state.searchError)
  const adding = useSessionDockStore((state) => state.adding)
  const closePicker = useSessionDockStore((state) => state.closePicker)
  const search = useSessionDockStore((state) => state.search)
  const add = useSessionDockStore((state) => state.add)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => { void search(query) }, 220)
    return () => window.clearTimeout(timer)
  }, [query, search])

  return (
    <div className="session-dock-picker">
      <header className="session-dock-header">
        <button type="button" className="session-dock-icon-button" onClick={closePicker} title="返回" aria-label="返回">
          <ArrowLeft size={17} />
        </button>
        <div className="session-dock-heading"><strong>添加置顶会话</strong><small>从所有项目中选择</small></div>
      </header>
      <div className="session-dock-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目、Agent 或会话"
          autoFocus
        />
        {searching && <Loader2 size={14} className="session-dock-spin" />}
      </div>
      {searchError && <div className="session-dock-inline-error">{searchError}</div>}
      <div className="session-dock-picker-results">
        {!searching && candidates.length === 0 ? (
          <div className="session-dock-empty compact">没有可添加的会话</div>
        ) : (
          <ol className="session-dock-candidate-list">
            {candidates.map((item) => (
              <li key={item.sessionId} className="session-dock-candidate">
                <span
                  className="session-dock-project-mark"
                  style={{ background: item.projectColor || 'var(--blue-light)' }}
                  aria-hidden="true"
                >
                  {item.projectIcon || item.projectName.slice(0, 1)}
                </span>
                <span className="session-dock-candidate-text">
                  <strong>{sessionDockTitle(item.sessionTitle, item.sessionId)}</strong>
                  <small>{item.projectName} · {item.agentName}</small>
                </span>
                <button
                  type="button"
                  className="session-dock-add-button"
                  onClick={() => { void add(item.sessionId) }}
                  disabled={!!adding[item.sessionId]}
                  title="置顶会话"
                  aria-label="置顶会话"
                >
                  {adding[item.sessionId]
                    ? <Loader2 size={15} className="session-dock-spin" />
                    : <Plus size={15} />}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
