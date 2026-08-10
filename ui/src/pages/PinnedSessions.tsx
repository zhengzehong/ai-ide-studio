import { Loader2, MessagesSquare, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionDockStore } from '../stores/session-dock.store'
import { sessionDockWorkspacePath } from '../components/session-dock/session-dock-format'
import { SessionDockPicker } from '../components/session-dock/SessionDockPicker'
import { SessionDockRow } from '../components/session-dock/SessionDockRow'
import '../components/session-dock/session-dock.css'

export function PinnedSessions() {
  const navigate = useNavigate()
  const items = useSessionDockStore((state) => state.items)
  const drawerOpen = useSessionDockStore((state) => state.open)
  const pickerOpen = useSessionDockStore((state) => state.pickerOpen)
  const loading = useSessionDockStore((state) => state.loading)
  const error = useSessionDockStore((state) => state.error)
  const removing = useSessionDockStore((state) => state.removing)
  const reordering = useSessionDockStore((state) => state.reordering)
  const loaded = useSessionDockStore((state) => state.loaded)
  const load = useSessionDockStore((state) => state.load)
  const openPicker = useSessionDockStore((state) => state.openPicker)
  const remove = useSessionDockStore((state) => state.remove)
  const reorder = useSessionDockStore((state) => state.reorder)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  if (pickerOpen && !drawerOpen) {
    return <section className="session-dock-page"><SessionDockPicker /></section>
  }

  const moveSession = (projectId: string, sessionId: string): void => {
    navigate(sessionDockWorkspacePath(projectId, sessionId))
  }

  const dropOn = (targetId: string): void => {
    if (!draggedId || draggedId === targetId || reordering) return
    const next = items.map((item) => item.sessionId)
    const from = next.indexOf(draggedId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(to, 0, next.splice(from, 1)[0]!)
    setDraggedId(null)
    void reorder(next)
  }

  const runningCount = items.filter((item) => item.activityState === 'running').length
  const unreadCount = items.filter((item) => item.unread).length

  return (
    <section className="session-dock-page" aria-label="置顶会话">
      <header className="session-dock-page-header">
        <div className="session-dock-heading">
          <strong>置顶会话</strong>
          <small>{items.length} 个会话 · {runningCount} 个运行 · {unreadCount} 个未读</small>
        </div>
        <div className="session-dock-header-actions">
          <button type="button" className="session-dock-add-label" onClick={openPicker}>
            <Plus size={16} /> 添加会话
          </button>
          <button type="button" className="session-dock-icon-button" onClick={() => { void load() }} title="刷新" aria-label="刷新">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>
      {error && (
        <div className="session-dock-inline-error">
          <span>{error}</span>
          <button type="button" onClick={() => { void load() }} title="重试" aria-label="重试"><RefreshCw size={14} /></button>
        </div>
      )}
      <div className="session-dock-page-body">
        {loading && items.length === 0 ? (
          <div className="session-dock-loading"><Loader2 size={18} className="session-dock-spin" /> 正在同步置顶会话...</div>
        ) : items.length === 0 ? (
          <div className="session-dock-empty">
            <div className="session-dock-empty-icon"><MessagesSquare size={20} /></div>
            <strong>还没有置顶会话</strong>
            <span>把需要持续关注的会话置顶到这里</span>
            <button type="button" onClick={openPicker}><Plus size={15} /> 添加会话</button>
          </div>
        ) : (
          <ol className="session-dock-list">
            {items.map((item) => (
              <SessionDockRow
                key={item.sessionId}
                item={item}
                removing={!!removing[item.sessionId]}
                reordering={reordering}
                onOpen={() => moveSession(item.projectId, item.sessionId)}
                onRemove={() => { void remove(item.sessionId) }}
                onDragStart={(event: DragEvent<HTMLSpanElement>) => {
                  setDraggedId(item.sessionId)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event: DragEvent<HTMLLIElement>) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event: DragEvent<HTMLLIElement>) => {
                  event.preventDefault()
                  dropOn(item.sessionId)
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
