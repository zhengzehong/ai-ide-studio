import { Pin, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePinnedSessionStore, type MobilePinnedSession } from '../stores/pinned-session.store'
import { pinnedSessionsPath } from './session-view-mode'

const REVEAL_WIDTH = 84
const DRAG_LONG_PRESS_MS = 400
const MOVE_CANCEL_PX = 10
const SWIPE_ENGAGE_PX = 8
const ROW_GAP = 16

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const diff = Math.max(0, Date.now() - timestamp)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function titleOf(item: MobilePinnedSession): string {
  return item.sessionTitle?.trim() || `会话 ${item.sessionId.slice(-6)}`
}

function triggerHaptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* ignore */
  }
}

export function PinnedSessionsPage() {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.heading}>
          <Pin size={19} color="var(--primary)" />
          <div>
            <div style={styles.title}>置顶会话</div>
            <div style={styles.subtitle}>长按拖拽排序 · 左滑取消置顶</div>
          </div>
        </div>
      </header>
      <PinnedSessionList />
    </div>
  )
}

interface DragInfo {
  id: string
  fromIndex: number
  targetIndex: number
  dy: number
}

export function PinnedSessionList() {
  const navigate = useNavigate()
  const items = usePinnedSessionStore((state) => state.items)
  const loading = usePinnedSessionStore((state) => state.loading)
  const loaded = usePinnedSessionStore((state) => state.loaded)
  const error = usePinnedSessionStore((state) => state.error)
  const removing = usePinnedSessionStore((state) => state.removing)
  const reordering = usePinnedSessionStore((state) => state.reordering)
  const load = usePinnedSessionStore((state) => state.load)
  const remove = usePinnedSessionStore((state) => state.remove)
  const markRead = usePinnedSessionStore((state) => state.markRead)
  const reorder = usePinnedSessionStore((state) => state.reorder)

  const [drag, setDrag] = useState<DragInfo | null>(null)
  const [swipe, setSwipe] = useState<{ id: string; x: number; animating: boolean } | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const reorderingRef = useRef(reordering)
  reorderingRef.current = reordering
  const swipeRef = useRef(swipe)
  swipeRef.current = swipe
  const dragInfoRef = useRef<{ id: string; fromIndex: number; startY: number } | null>(null)
  const metricsRef = useRef<{ id: string; top: number; height: number }[]>([])
  const pendingRef = useRef<{ id: string; index: number; x: number; y: number; timer: number } | null>(null)
  const swipeGestureRef = useRef<{ id: string; startX: number; startY: number; base: number } | null>(null)
  const swipeLatestRef = useRef(0)
  const targetRef = useRef(0)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  useEffect(() => () => {
    const pending = pendingRef.current
    if (pending) window.clearTimeout(pending.timer)
  }, [])

  // 拖拽期间阻止列表滚动(touchmove 不 preventDefault 会触发原生滚动并打断指针手势)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onTouchMove = (event: TouchEvent) => {
      if (dragInfoRef.current) event.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  /** 指针在冻结行位点中的落点 → 插入槽位(去掉被拖行自身的占位) */
  const computeTargetIndex = useCallback((clientY: number, fromIndex: number): number => {
    const metrics = metricsRef.current
    let slot = 0
    for (const metric of metrics) {
      if (clientY > metric.top + metric.height / 2) slot += 1
    }
    const target = slot > fromIndex ? slot - 1 : slot
    return Math.max(0, Math.min(target, metrics.length - 1))
  }, [])

  const handleGestureMove = useCallback((event: PointerEvent) => {
    const info = dragInfoRef.current
    if (info) {
      const dy = event.clientY - info.startY
      const target = computeTargetIndex(event.clientY, info.fromIndex)
      targetRef.current = target
      setDrag({ id: info.id, fromIndex: info.fromIndex, targetIndex: target, dy })
      return
    }
    const gesture = swipeGestureRef.current
    if (gesture) {
      const x = Math.min(0, Math.max(-REVEAL_WIDTH - 12, gesture.base + (event.clientX - gesture.startX)))
      swipeLatestRef.current = x
      setSwipe({ id: gesture.id, x, animating: false })
      return
    }
    const pending = pendingRef.current
    if (!pending) return
    const dx = event.clientX - pending.x
    const adx = Math.abs(dx)
    const ady = Math.abs(event.clientY - pending.y)
    if (adx <= MOVE_CANCEL_PX && ady <= MOVE_CANCEL_PX) return
    window.clearTimeout(pending.timer)
    pendingRef.current = null
    // 水平左滑 → 进入取消置顶revealed手势;垂直移动仅视为滚动
    if (dx < -SWIPE_ENGAGE_PX && adx > ady) {
      swipeGestureRef.current = {
        id: pending.id,
        startX: event.clientX,
        startY: event.clientY,
        base: swipeRef.current?.id === pending.id ? swipeRef.current.x : 0,
      }
      swipeLatestRef.current = swipeGestureRef.current.base
      setSwipe({ id: pending.id, x: swipeGestureRef.current.base, animating: false })
      suppressClickRef.current = true
    }
  }, [computeTargetIndex])

  const handleGestureEnd = useCallback(() => {
    window.removeEventListener('pointermove', handleGestureMove)
    window.removeEventListener('pointerup', handleGestureEnd)
    window.removeEventListener('pointercancel', handleGestureEnd)
    const info = dragInfoRef.current
    if (info) {
      dragInfoRef.current = null
      const { fromIndex } = info
      const target = targetRef.current
      const currentItems = itemsRef.current
      if (target !== fromIndex && currentItems.length > 1) {
        const ids = currentItems.map((item) => item.sessionId)
        const moved = ids.splice(fromIndex, 1)[0]
        if (moved) ids.splice(target, 0, moved)
        void reorder(ids)
      }
      setDrag(null)
      suppressClickRef.current = true
      return
    }
    if (swipeGestureRef.current) {
      const id = swipeGestureRef.current.id
      swipeGestureRef.current = null
      const open = swipeLatestRef.current < -REVEAL_WIDTH / 2
      setSwipe(open ? { id, x: -REVEAL_WIDTH, animating: true } : null)
      return
    }
    const pending = pendingRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingRef.current = null
    }
  }, [handleGestureMove, reorder])

  const startDrag = useCallback(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return
    if (reorderingRef.current) return
    if (swipeRef.current) setSwipe(null)
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-pin-id]') ?? [])
    metricsRef.current = nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { id: node.dataset.pinId ?? '', top: rect.top, height: rect.height }
    })
    dragInfoRef.current = { id: pending.id, fromIndex: pending.index, startY: pending.y }
    targetRef.current = pending.index
    setDrag({ id: pending.id, fromIndex: pending.index, targetIndex: pending.index, dy: 0 })
    suppressClickRef.current = true
    triggerHaptic()
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[data-pin-id]')
    if (!rowEl) {
      if (swipeRef.current) setSwipe(null)
      return
    }
    const id = rowEl.dataset.pinId
    if (!id) return
    const index = itemsRef.current.findIndex((item) => item.sessionId === id)
    if (index < 0) return
    if (swipeRef.current && swipeRef.current.id !== id) setSwipe(null)
    if (reorderingRef.current) return
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timer)
    pendingRef.current = {
      id,
      index,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(startDrag, DRAG_LONG_PRESS_MS),
    }
    window.addEventListener('pointermove', handleGestureMove)
    window.addEventListener('pointerup', handleGestureEnd)
    window.addEventListener('pointercancel', handleGestureEnd)
  }

  const openSession = (item: MobilePinnedSession): void => {
    if (item.unread) void markRead(item.sessionId)
    navigate(`/chat/${item.sessionId}`, { state: { returnTo: pinnedSessionsPath } })
  }

  const handleRowActivate = (item: MobilePinnedSession): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (swipeRef.current?.id === item.sessionId && swipeRef.current.x < 0) {
      setSwipe(null)
      return
    }
    openSession(item)
  }

  const handleRemove = (item: MobilePinnedSession): void => {
    setSwipe(null)
    void remove(item.sessionId)
  }

  const draggedMetric = drag ? metricsRef.current.find((metric) => metric.id === drag.id) : undefined
  const shift = draggedMetric ? draggedMetric.height + ROW_GAP : 0
  const offsetForIndex = (index: number): number => {
    if (!drag) return 0
    if (index > drag.fromIndex && index <= drag.targetIndex) return -shift
    if (index < drag.fromIndex && index >= drag.targetIndex) return shift
    return 0
  }

  return (
    <div style={styles.embedded}>
      {error && <div style={styles.error}>{error}</div>}
      <div ref={listRef} style={styles.list} onPointerDown={handlePointerDown}>
        {loading && items.length === 0 ? (
          <div style={styles.empty}><Loader2 size={22} className="mobile-spin" /> 正在同步...</div>
        ) : items.length === 0 ? (
          <div style={styles.empty}>
            <Pin size={38} color="var(--text-muted)" strokeWidth={1.3} />
            <strong style={styles.emptyTitle}>还没有置顶会话</strong>
            <span>在“会话”页长按任意会话即可置顶</span>
          </div>
        ) : (
          items.map((item, index) => {
            const isDragging = drag !== null && drag.id === item.sessionId
            const openSwipe = swipe !== null && swipe.id === item.sessionId ? swipe : null
            return (
              <PinnedSessionRow
                key={item.sessionId}
                item={item}
                removing={!!removing[item.sessionId]}
                dragY={isDragging && drag ? drag.dy : offsetForIndex(index)}
                dragActive={isDragging}
                liftX={openSwipe ? openSwipe.x : 0}
                liftAnimating={!!openSwipe && openSwipe.animating}
                onOpen={() => handleRowActivate(item)}
                onRemove={() => handleRemove(item)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

export function PinnedSessionRow({
  item,
  removing,
  dragY,
  dragActive,
  liftX,
  liftAnimating,
  onOpen,
  onRemove,
}: {
  item: MobilePinnedSession
  removing: boolean
  dragY: number
  dragActive: boolean
  liftX: number
  liftAnimating: boolean
  onOpen: () => void
  onRemove: () => void
}) {
  const stateLabel = item.activityState === 'running' ? '运行中' : item.unread ? '未读' : '空闲'
  const stateColor = item.activityState === 'running' ? 'var(--success)' : item.unread ? 'var(--primary)' : 'var(--text-muted)'
  return (
    <div
      data-pin-id={item.sessionId}
      style={{
        ...styles.rowWrap,
        transform: `translateY(${dragY}px)`,
        transition: dragActive ? 'none' : 'transform .18s ease',
        zIndex: dragActive ? 30 : 1,
        opacity: removing ? 0.45 : 1,
        ...(dragActive ? styles.rowDragging : {}),
      }}
    >
      <button
        type="button"
        style={styles.unpinButton}
        tabIndex={liftX < 0 ? 0 : -1}
        aria-label="取消置顶"
        onClick={onRemove}
      >
        取消置顶
      </button>
      <div
        role="button"
        tabIndex={0}
        style={{
          ...styles.row,
          transform: `translateX(${liftX}px)`,
          transition: liftAnimating ? 'transform .2s ease' : 'none',
        }}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
        }}
      >
        <span style={{ ...styles.projectMark, background: item.projectColor || 'var(--primary)' }}>{item.projectIcon || item.projectName.slice(0, 1)}</span>
        <div style={styles.rowMain}>
          <div style={styles.rowTitle}>{titleOf(item)}</div>
          <div style={styles.meta}>{item.projectName} · {item.agentName}</div>
          <div style={{ ...styles.status, color: stateColor }}><span style={{ ...styles.dot, background: stateColor }} />{stateLabel}{item.stage ? ` · ${item.stage}` : ''}</div>
        </div>
        <time style={styles.time}>{formatTime(item.lastActivityAt)}</time>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  embedded: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: { height: 58, padding: 'calc(8px + var(--safe-top)) 14px 8px', boxSizing: 'content-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-light)' },
  heading: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 },
  title: { fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' },
  subtitle: { marginTop: 2, fontSize: 11, color: 'var(--text-muted)' },
  error: { margin: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--error-bg)', color: 'var(--error)', fontSize: 12 },
  list: { flex: 1, overflowY: 'auto', background: 'var(--bg)' },
  empty: { height: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 13 },
  emptyTitle: { color: 'var(--text-secondary)', fontSize: 15 },
  rowWrap: { position: 'relative', margin: '8px 10px', borderRadius: 14 },
  rowDragging: { boxShadow: '0 8px 24px rgba(26, 26, 46, 0.18)' },
  unpinButton: { position: 'absolute', top: 0, right: 0, bottom: 0, width: REVEAL_WIDTH, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 14, background: 'var(--error)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', zIndex: 1 },
  row: { position: 'relative', zIndex: 2, minHeight: 82, borderRadius: 14, background: 'var(--bg-card)', padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', touchAction: 'pan-y' },
  projectMark: { width: 32, height: 32, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 14 },
  rowMain: { minWidth: 0, flex: 1 },
  rowTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 },
  meta: { marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 11 },
  status: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 500 },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  time: { alignSelf: 'flex-start', marginTop: 2, flexShrink: 0, color: 'var(--text-muted)', fontSize: 10 },
}
