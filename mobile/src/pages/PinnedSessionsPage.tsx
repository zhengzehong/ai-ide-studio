import { Pin, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useConversationCatalog } from '../stores/conversation-catalog.store'
import { projectTeamPins } from '../utils/team-list-projections'
import { ConversationKindTag } from '../components/session-list/ConversationKindTag'
import { useNavigate } from 'react-router-dom'
import { usePinnedSessionStore, type MobilePinnedSession } from '../stores/pinned-session.store'
import { AgentAvatar, ListRow, ProjectChip, formatRelativeTime, groupStyles } from '../components/session-list/list-kit'
import { pinnedSessionsPath } from './session-view-mode'

const REVEAL_WIDTH = 84
const DRAG_LONG_PRESS_MS = 400
const MOVE_CANCEL_PX = 10
const SWIPE_ENGAGE_PX = 8

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

export interface PinnedGroup {
  teamId?: string
  key: string
  agentId: string
  agentName: string
  projectId: string
  projectName: string
  projectIcon: string | null
  projectColor: string | null
  sessions: MobilePinnedSession[]
}

/** 动态页同款分组:Agent+项目一组。入参已按全局 sortOrder 排好,组序=组内首项出现序 */
export function groupPinnedItems(items: MobilePinnedSession[]): PinnedGroup[] {
  const groups: PinnedGroup[] = []
  const byKey = new Map<string, PinnedGroup>()
  for (const item of items) {
    const key = `${item.agentId}:${item.projectId}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        teamId: item.teamId,
        agentId: item.agentId,
        agentName: item.agentName,
        projectId: item.projectId,
        projectName: item.projectName,
        projectIcon: item.projectIcon,
        projectColor: item.projectColor,
        sessions: [],
      }
      byKey.set(key, group)
      groups.push(group)
    }
    group.sessions.push(item)
  }
  return groups
}

/** 动态页同款分组卡片:组头 AgentAvatar + 名称 + N 个会话 + 项目 chip;行由调用方作为 children 传入 */
export function PinnedGroupCard({ group, children }: { group: PinnedGroup; children: ReactNode }) {
  return (
    // overflow 放开:拖拽中的行要能浮出组卡片边界
    <section className="group-block" data-agent-id={group.agentId} style={{ ...groupStyles.group, overflow: 'visible' }}>
      <div style={{ ...groupStyles.head, ...groupStyles.headPlain }}>
        <AgentAvatar agentId={group.agentId} name={group.agentName} />
        <div style={groupStyles.info}>
          <div style={groupStyles.name}>{group.agentName}<ConversationKindTag team={!!group.teamId} /></div>
          <div style={groupStyles.sub}>{group.sessions.length} 个会话</div>
        </div>
        <ProjectChip name={group.projectName} icon={group.projectIcon} color={group.projectColor} />
      </div>
      {children}
    </section>
  )
}

export function PinnedSessionsPage() {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.heading}>
          <div>
            <h1 style={styles.title}>置顶会话</h1>
            <div style={styles.subtitle}>长按拖拽组内排序 · 左滑取消置顶</div>
          </div>
        </div>
      </header>
      <PinnedSessionList />
    </div>
  )
}

interface DragInfo {
  id: string
  groupKey: string
  groupIds: string[]
  fromIndex: number
  targetIndex: number
  dy: number
}

export function PinnedSessionList() {
  const navigate = useNavigate()
  const rawItems = usePinnedSessionStore((state) => state.items)
  const catalog = useConversationCatalog(state => state.catalog)
  const catalogLoaded = useConversationCatalog(state => state.loaded)
  const catalogError = useConversationCatalog(state => state.error)
  const loadCatalog = useConversationCatalog(state => state.load)
  const items = useMemo(() => catalogLoaded ? projectTeamPins(rawItems, catalog) : [], [rawItems, catalog, catalogLoaded])
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
  const dragInfoRef = useRef<{ id: string; groupKey: string; groupIds: string[]; fromIndex: number; startY: number } | null>(null)
  const metricsRef = useRef<{ id: string; top: number; height: number }[]>([])
  const pendingRef = useRef<{ id: string; x: number; y: number; timer: number } | null>(null)
  const swipeGestureRef = useRef<{ id: string; startX: number; startY: number; base: number } | null>(null)
  const swipeLatestRef = useRef(0)
  const targetRef = useRef(0)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (!loaded) void load()
    if (!catalogLoaded) void loadCatalog()
  }, [load, loaded, loadCatalog, catalogLoaded])

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

  /** 指针在本组冻结行位点中的落点 → 组内插入槽位(去掉被拖行自身的占位) */
  const computeTargetIndex = useCallback((clientY: number, fromIndex: number, groupIds: string[]): number => {
    const metrics = metricsRef.current.filter((metric) => groupIds.includes(metric.id))
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
      const target = computeTargetIndex(event.clientY, info.fromIndex, info.groupIds)
      targetRef.current = target
      setDrag({ id: info.id, groupKey: info.groupKey, groupIds: info.groupIds, fromIndex: info.fromIndex, targetIndex: target, dy })
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
    // 水平滑动进入手势:关闭态只认左滑(展开),展开态左右都认(右滑收起);垂直移动仅视为滚动
    const rowOpen = swipeRef.current?.id === pending.id && swipeRef.current.x < 0
    if (adx > SWIPE_ENGAGE_PX && adx > ady && (dx < 0 || rowOpen)) {
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
      // 组内换序:重排本组段落后映射回全局 sortOrder ids(sessionDock.reorder 语义不变)
      const groups = groupPinnedItems(itemsRef.current)
      const group = groups.find((candidate) => candidate.key === info.groupKey)
      if (target !== fromIndex && group && group.sessions.length > 1) {
        const groupIds = group.sessions.map((session) => session.sessionId)
        const moved = groupIds.splice(fromIndex, 1)[0]
        if (moved) groupIds.splice(Math.min(target, groupIds.length), 0, moved)
        const ids = groups.flatMap((candidate) => (
          candidate.key === info.groupKey ? groupIds : candidate.sessions.map((session) => session.sessionId)
        ))
        void reorder(ids)
      }
      setDrag(null)
      suppressClickRef.current = true
      return
    }
    if (swipeGestureRef.current) {
      const id = swipeGestureRef.current.id
      swipeGestureRef.current = null
      // 过半吸附展开,不足半程动画弹回(置 x=0 且 animating,保持过渡)
      const open = swipeLatestRef.current < -REVEAL_WIDTH / 2
      setSwipe(open ? { id, x: -REVEAL_WIDTH, animating: true } : { id, x: 0, animating: true })
      return
    }
    const pending = pendingRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingRef.current = null
      const openSwipe = swipeRef.current
      if (openSwipe && openSwipe.id === pending.id && openSwipe.x < 0) {
        // 干净点按已展开的行 → 直接收起;不依赖真机上易被长按/pointercancel 吃掉的 click
        suppressClickRef.current = true
        setSwipe({ id: pending.id, x: 0, animating: true })
      }
    }
  }, [handleGestureMove, reorder])

  const startDrag = useCallback(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return
    if (reorderingRef.current) return
    const openSwipe = swipeRef.current
    if (openSwipe && openSwipe.id === pending.id && openSwipe.x < 0) {
      // 已展开的行:长按视为收起,不进入拖拽,避免"想点按却变成拖拽"
      suppressClickRef.current = true
      setSwipe({ id: pending.id, x: 0, animating: true })
      return
    }
    if (openSwipe) setSwipe(null)
    const group = groupPinnedItems(itemsRef.current).find((candidate) => (
      candidate.sessions.some((session) => session.sessionId === pending.id)
    ))
    if (!group || group.sessions.length < 2) return
    const fromIndex = group.sessions.findIndex((session) => session.sessionId === pending.id)
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-pin-id]') ?? [])
    metricsRef.current = nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { id: node.dataset.pinId ?? '', top: rect.top, height: rect.height }
    })
    dragInfoRef.current = {
      id: pending.id,
      groupKey: group.key,
      groupIds: group.sessions.map((session) => session.sessionId),
      fromIndex,
      startY: pending.y,
    }
    targetRef.current = fromIndex
    setDrag({ id: pending.id, groupKey: group.key, groupIds: dragInfoRef.current.groupIds, fromIndex, targetIndex: fromIndex, dy: 0 })
    suppressClickRef.current = true
    triggerHaptic()
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // 新手势开始:上一手势若没产生 click(如行外松手),遗留的抑制标记在这里清掉
    suppressClickRef.current = false
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[data-pin-id]')
    if (!rowEl) {
      closeSwipeAnimated()
      return
    }
    const id = rowEl.dataset.pinId
    if (!id) return
    // 取消置顶按钮自行处理点击,不进入长按/滑动流程
    if ((event.target as HTMLElement).closest('button')) return
    const index = itemsRef.current.findIndex((item) => item.sessionId === id)
    if (index < 0) return
    if (swipeRef.current && swipeRef.current.id !== id) closeSwipeAnimated()
    if (reorderingRef.current) return
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timer)
    pendingRef.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(startDrag, DRAG_LONG_PRESS_MS),
    }
    window.addEventListener('pointermove', handleGestureMove)
    window.addEventListener('pointerup', handleGestureEnd)
    window.addEventListener('pointercancel', handleGestureEnd)
  }

  const openSession = (item: MobilePinnedSession): void => {
    if (item.unread && !item.teamId) void markRead(item.sessionId)
    navigate(`/chat/${item.sessionId}`, { state: { returnTo: pinnedSessionsPath } })
  }

  /** 收起已展开的取消置顶按钮(带回弹动画;x=0 时点击仍可正常进会话) */
  const closeSwipeAnimated = useCallback(() => {
    const current = swipeRef.current
    if (!current) return
    setSwipe({ id: current.id, x: 0, animating: true })
  }, [])

  const handleRowActivate = (item: MobilePinnedSession): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (swipeRef.current?.id === item.sessionId && swipeRef.current.x < 0) {
      setSwipe({ id: item.sessionId, x: 0, animating: true })
      return
    }
    openSession(item)
  }

  const handleRemove = (item: MobilePinnedSession): void => {
    setSwipe(null)
    void remove(item.sessionId)
  }

  // 让位量按冻结的相邻行 top 差逐行计算:行高不一(detail 行有无)时均匀 shift 会错位
  const displacementFor = (group: PinnedGroup, localIndex: number): number => {
    if (!drag || drag.groupKey !== group.key || drag.fromIndex === drag.targetIndex) return 0
    const metrics = metricsRef.current.filter((metric) => drag.groupIds.includes(metric.id))
    if (localIndex >= metrics.length) return 0
    const tops = metrics.map((metric) => metric.top)
    if (localIndex > drag.fromIndex && localIndex <= drag.targetIndex) {
      return (tops[localIndex - 1] ?? 0) - (tops[localIndex] ?? 0)
    }
    if (localIndex < drag.fromIndex && localIndex >= drag.targetIndex) {
      return (tops[localIndex + 1] ?? 0) - (tops[localIndex] ?? 0)
    }
    return 0
  }

  return (
    <div style={styles.embedded}>
      {(error || catalogError) && <button style={styles.error} onClick={() => { void load(); void loadCatalog() }}>{error || catalogError} · 重试</button>}
      <div ref={listRef} style={styles.list} onPointerDown={handlePointerDown}>
        {(loading || (!catalogLoaded && !catalogError)) && items.length === 0 ? (
          <div style={styles.empty}><Loader2 size={22} className="mobile-spin" /> 正在同步...</div>
        ) : items.length === 0 ? (
          <div style={styles.empty}>
            <Pin size={38} color="var(--text-muted)" strokeWidth={1.3} />
            <strong style={styles.emptyTitle}>还没有置顶会话</strong>
            <span>在“会话”页长按任意会话即可置顶</span>
          </div>
        ) : (
          groupPinnedItems(items).map((group) => (
            <PinnedGroupCard key={group.key} group={group}>
              {group.sessions.map((item, localIndex) => {
                const isDragging = drag !== null && drag.id === item.sessionId
                const openSwipe = swipe !== null && swipe.id === item.sessionId ? swipe : null
                return (
                  <PinnedSessionRow
                    key={item.sessionId}
                    item={item}
                    removing={!!removing[item.sessionId]}
                    dragY={isDragging && drag ? drag.dy : displacementFor(group, localIndex)}
                    dragActive={isDragging}
                    liftX={openSwipe ? openSwipe.x : 0}
                    liftAnimating={!!openSwipe && openSwipe.animating}
                    onOpen={() => handleRowActivate(item)}
                    onRemove={() => handleRemove(item)}
                  />
                )
              })}
            </PinnedGroupCard>
          ))
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
  const running = item.activityState === 'running'
  const label = running ? '执行中' : item.unread ? '有新回复' : '空闲'
  const labelColor = running ? 'var(--success)' : item.unread ? 'var(--primary)' : 'var(--text-muted)'
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
        style={{
          ...styles.row,
          transform: `translateX(${liftX}px)`,
          transition: liftAnimating ? 'transform .2s ease' : 'none',
        }}
      >
        {/* 行内容与动态页共用 ListRow;点击/键盘由 ListRow 承接,壳只负责滑动位移 */}
        <ListRow
          title={titleOf(item)}
          strong={item.unread}
          time={formatRelativeTime(item.lastActivityAt)}
          label={label}
          labelColor={labelColor}
          pulse={running}
          detail={item.stage || undefined}
          onClick={onOpen}
        />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  embedded: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  header: { padding: 'calc(14px + var(--safe-top)) 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  heading: { minWidth: 0 },
  title: { margin: 0, color: 'var(--text-primary)', fontSize: 21, lineHeight: 1.25, fontWeight: 700 },
  subtitle: { marginTop: 2, color: 'var(--text-muted)', fontSize: 12 },
  error: { margin: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--error-bg)', color: 'var(--error)', fontSize: 12 },
  list: { flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg)', padding: '4px 0 20px' },
  empty: { height: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 13 },
  emptyTitle: { color: 'var(--text-secondary)', fontSize: 15 },
  rowWrap: { position: 'relative' },
  rowDragging: { boxShadow: '0 8px 24px rgba(26, 26, 46, 0.18)', borderRadius: 14 },
  unpinButton: { position: 'absolute', top: 0, right: 0, bottom: 0, width: REVEAL_WIDTH, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '0 14px 14px 0', background: 'var(--error)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', zIndex: 1 },
  row: { position: 'relative', zIndex: 2, background: 'var(--bg-card)' },
}
