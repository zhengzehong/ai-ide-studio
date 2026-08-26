import { ArrowDown, ArrowUp, Loader2, Pin, PinOff } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePinnedSessionStore, type MobilePinnedSession } from '../stores/pinned-session.store'
import { pinnedSessionsPath } from './session-view-mode'

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

export function PinnedSessionsPage() {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.heading}>
          <Pin size={19} color="var(--primary)" />
          <div>
            <div style={styles.title}>置顶会话</div>
            <div style={styles.subtitle}>跨项目持续关注</div>
          </div>
        </div>
      </header>
      <PinnedSessionList />
    </div>
  )
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

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  const openSession = (item: MobilePinnedSession): void => {
    if (item.unread) void markRead(item.sessionId)
    navigate(`/chat/${item.sessionId}`, { state: { returnTo: pinnedSessionsPath } })
  }

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= items.length || reordering) return
    const ids = items.map((item) => item.sessionId)
    const current = ids[index]!
    ids[index] = ids[target]!
    ids[target] = current
    void reorder(ids)
  }

  return (
    <div style={styles.embedded}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.list}>
        {loading && items.length === 0 ? (
          <div style={styles.empty}><Loader2 size={22} className="mobile-spin" /> 正在同步...</div>
        ) : items.length === 0 ? (
          <div style={styles.empty}>
            <Pin size={38} color="#b2b2b2" strokeWidth={1.3} />
            <strong style={styles.emptyTitle}>还没有置顶会话</strong>
            <span>在“会话”页长按任意会话即可置顶</span>
          </div>
        ) : (
          items.map((item, index) => (
            <PinnedSessionRow
              key={item.sessionId}
              item={item}
              index={index}
              total={items.length}
              removing={!!removing[item.sessionId]}
              reordering={reordering}
              onOpen={() => openSession(item)}
              onRemove={() => { void remove(item.sessionId) }}
              onMove={(direction) => move(index, direction)}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function PinnedSessionRow({
  item,
  index,
  total,
  removing,
  reordering,
  onOpen,
  onRemove,
  onMove,
}: {
  item: MobilePinnedSession
  index: number
  total: number
  removing: boolean
  reordering: boolean
  onOpen: () => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const stateLabel = item.activityState === 'running' ? '运行中' : item.unread ? '未读' : '空闲'
  const stateColor = item.activityState === 'running' ? '#07c160' : item.unread ? '#fa5151' : '#999'
  return (
    <div style={styles.row} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}>
      <span style={{ ...styles.projectMark, background: item.projectColor || '#576b95' }}>{item.projectIcon || item.projectName.slice(0, 1)}</span>
      <div style={styles.rowMain}>
        <div style={styles.rowTitle}>{titleOf(item)}</div>
        <div style={styles.meta}>{item.projectName} · {item.agentName}</div>
        <div style={{ ...styles.status, color: stateColor }}><span style={{ ...styles.dot, background: stateColor }} />{stateLabel}{item.stage ? ` · ${item.stage}` : ''}</div>
      </div>
      <time style={styles.time}>{formatTime(item.lastActivityAt)}</time>
      <div style={styles.actions} onClick={(event) => event.stopPropagation()}>
        <button type="button" style={styles.smallButton} disabled={reordering || index === 0} onClick={() => onMove(-1)} aria-label="上移"><ArrowUp size={14} /></button>
        <button type="button" style={styles.smallButton} disabled={reordering || index === total - 1} onClick={() => onMove(1)} aria-label="下移"><ArrowDown size={14} /></button>
        <button type="button" style={styles.smallButton} disabled={removing} onClick={onRemove} aria-label="取消置顶"><PinOff size={15} /></button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: '#ededed' },
  embedded: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', background: '#ededed' },
  header: { height: 58, padding: 'calc(8px + var(--safe-top)) 14px 8px', boxSizing: 'content-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f7f7f7', borderBottom: '0.5px solid #e0e0e0' },
  heading: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 },
  title: { fontSize: 17, fontWeight: 600, color: '#191919' },
  subtitle: { marginTop: 2, fontSize: 11, color: '#999' },
  error: { margin: 8, padding: '8px 10px', borderRadius: 6, background: '#fff1f0', color: '#d4380d', fontSize: 12 },
  list: { flex: 1, overflowY: 'auto', background: '#ededed' },
  empty: { height: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: '#999', fontSize: 13 },
  emptyTitle: { color: '#555', fontSize: 15 },
  row: { minHeight: 82, padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 9, background: '#fff', borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer' },
  projectMark: { width: 32, height: 32, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 14 },
  rowMain: { minWidth: 0, flex: 1 },
  rowTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#191919', fontSize: 14, fontWeight: 500 },
  meta: { marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#888', fontSize: 11 },
  status: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  time: { alignSelf: 'flex-start', marginTop: 2, flexShrink: 0, color: '#aaa', fontSize: 10 },
  actions: { display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 },
  smallButton: { width: 26, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: 'transparent', color: '#999' },
}
