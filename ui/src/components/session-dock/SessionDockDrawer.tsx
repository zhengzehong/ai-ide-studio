import { Loader2, MessagesSquare, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionDockStore } from '../../stores/session-dock.store'
import { sessionDockWorkspacePath } from './session-dock-format'
import { SessionDockPicker } from './SessionDockPicker'
import { SessionDockRow } from './SessionDockRow'

export function SessionDockDrawer() {
  const navigate = useNavigate()
  const items = useSessionDockStore((state) => state.items)
  const open = useSessionDockStore((state) => state.open)
  const pickerOpen = useSessionDockStore((state) => state.pickerOpen)
  const loading = useSessionDockStore((state) => state.loading)
  const error = useSessionDockStore((state) => state.error)
  const removing = useSessionDockStore((state) => state.removing)
  const reordering = useSessionDockStore((state) => state.reordering)
  const closeDrawer = useSessionDockStore((state) => state.closeDrawer)
  const openPicker = useSessionDockStore((state) => state.openPicker)
  const load = useSessionDockStore((state) => state.load)
  const remove = useSessionDockStore((state) => state.remove)
  const reorder = useSessionDockStore((state) => state.reorder)
  const [draggedId, setDraggedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeDrawer, open])

  if (pickerOpen) return <section className="session-dock-drawer session-dock-drawer--open"><SessionDockPicker /></section>

  const runningCount = items.filter((item) => item.activityState === 'running').length
  const unreadCount = items.filter((item) => item.unread).length

  const openSession = (projectId: string, sessionId: string): void => {
    closeDrawer()
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

  return (
    <section
      className={`session-dock-drawer${open ? ' session-dock-drawer--open' : ''}`}
      aria-hidden={!open}
      aria-label="全局会话"
    >
      <header className="session-dock-header">
        <div className="session-dock-heading">
          <strong>全局会话</strong>
          <small>{items.length} 个固定 · {runningCount} 个运行 · {unreadCount} 个未读</small>
        </div>
        <div className="session-dock-header-actions">
          <button type="button" className="session-dock-icon-button" onClick={openPicker} title="添加会话" aria-label="添加会话">
            <Plus size={17} />
          </button>
          <button type="button" className="session-dock-icon-button" onClick={closeDrawer} title="关闭" aria-label="关闭">
            <X size={17} />
          </button>
        </div>
      </header>

      {error && (
        <div className="session-dock-inline-error">
          <span>{error}</span>
          <button type="button" onClick={() => { void load() }} title="重试" aria-label="重试"><RefreshCw size={14} /></button>
        </div>
      )}

      <div className="session-dock-body">
        {loading && items.length === 0 ? (
          <div className="session-dock-loading"><Loader2 size={18} className="session-dock-spin" /> 正在同步会话...</div>
        ) : items.length === 0 ? (
          <div className="session-dock-empty">
            <div className="session-dock-empty-icon"><MessagesSquare size={20} /></div>
            <strong>还没有全局会话</strong>
            <span>从所有项目中选择需要持续关注的会话</span>
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
                onOpen={() => openSession(item.projectId, item.sessionId)}
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
