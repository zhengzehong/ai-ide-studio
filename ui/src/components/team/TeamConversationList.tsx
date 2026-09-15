import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Loader2, Plus, RefreshCw } from 'lucide-react'
import { ContextMenu, PromptDialog, ConfirmDialog } from '../ModalDialog'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import type { SessionIndicatorStateMap } from '../../utils/session-indicators'
import { resolveTeamConversationIndicators, sortTeamConversations, teamConversationListNeedsRefresh } from './team-conversation-state'
import { formatTime } from '../../pages/workspace/helpers'
import { SessionListRow } from '../session/SessionListRow'
import { useProjectSessionStatsStore } from '../../stores/project-session-stats.store'
import { useSessionDockStore } from '../../stores/session-dock.store'
import { teamCacheKey, teamListCache, subscribeTeamListInvalidation, shareTeamRequest, invalidateTeamRequest, newTeamRequestScope, type TeamConversation } from './team-view-cache'

// 线行与缓存/深链共用同一份定义，避免字段两处漂移。
type Conversation = TeamConversation

interface Props {
  team: TeamData
  activeId: string | null
  onSelect: (conversation: Conversation | null) => void
  onMasterSession: (sessionId: string | null) => void
  runningSessionIds?: SessionIndicatorStateMap
  sessionActivityStates?: Record<string, 'running' | 'idle' | undefined>
}

export function TeamConversationList({ team, activeId, onSelect, onMasterSession, runningSessionIds = {}, sessionActivityStates = {} }: Props) {
  const cacheKey = teamCacheKey(team.project_id, team.id)
  const [requestScope] = useState(newTeamRequestScope)
  const [items, setItems] = useState<Conversation[]>(() => teamListCache.get(cacheKey) as Conversation[] || [])
  const requestSeq = useRef(0)
  const mounted = useRef(true)
  const selectedId = useRef(activeId)
  useEffect(() => { selectedId.current = activeId }, [activeId])
  const invalidateRequests = useCallback((): void => { requestSeq.current++ }, [])
  const summary = useProjectSessionStatsStore(state => state.statsByProjectId[team.project_id]?.teams?.find(item => item.teamId === team.id))
  // 置顶优先：坞命中集只用于排序（客户端排序，理由：坞是全局单例、线列表只关心命中与否，
  // 不必为排序动服务端 join；坞变化经 zustand 订阅即时重排）。
  const pinnedSessionIds = useSessionDockStore(state => state.items.map(item => item.sessionId).join('\n'))
  const pinnedIds = useMemo(
    () => new Set(pinnedSessionIds ? pinnedSessionIds.split('\n') : []),
    [pinnedSessionIds],
  )
  // 排序放渲染期：坞（置顶态）随时可能从面板/坞抽屉变化，state 里存原始行、渲染时才排，避免漏重排。
  const rows = useMemo(() => sortTeamConversations(items, pinnedIds), [items, pinnedIds])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ item: Conversation; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<{ item: Conversation; action: 'rename' | 'archive' | 'delete' } | null>(null)
  const [mutating, setMutating] = useState(false)
  const mutationPending = useRef(false)

  const load = useCallback(async (force = false): Promise<void> => {
    if (!mounted.current) return
    const seq = ++requestSeq.current
    setLoading(teamListCache.get(cacheKey) === undefined)
    setError(null)
    try {
      const requestKey = `list:${cacheKey}:${requestScope}`
      if (force) invalidateTeamRequest(requestKey)
      const rows = await shareTeamRequest(requestKey, () => wsClient.request({ type: 'team.conversation.list', teamId: team.id }))
      if (seq !== requestSeq.current) return
      const next = Array.isArray(rows) ? rows as Conversation[] : []
      teamListCache.set(cacheKey, next)
      setItems(next)
      // 选中态由 Workspace 持有：这里只兜底"选中的线已消失"（删除/换团队），绝不替用户回选。
      const currentId = selectedId.current
      if (currentId && !next.some(item => item.id === currentId)) { onMasterSession(null); onSelect(null) }
    } catch (cause) {
      if (seq === requestSeq.current) setError(cause instanceof Error ? cause.message : '团队会话加载失败')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [team.id, cacheKey, onSelect, onMasterSession, requestScope])

  useEffect(() => {
    mounted.current = true
    const timer = window.setTimeout(() => { void load() }, 0)
    const off = wsClient.on('reconnected', () => { void load(true) })
    let refreshTimer: number | undefined
    const offTeam = wsClient.on('team:update', msg => {
      if (msg.teamId !== team.id || !teamConversationListNeedsRefresh(msg)) return
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => { void load(true) }, 300)
    })
    // 置顶/标未读改的是坞与已读位，服务端不发 team:update：本地失效信号到位后重拉一次。
    const offInvalidate = subscribeTeamListInvalidation(key => { if (key === cacheKey) void load(true) })
    return () => { mounted.current = false; window.clearTimeout(timer); window.clearTimeout(refreshTimer); invalidateRequests(); off(); offTeam(); offInvalidate() }
  }, [load, team.id, invalidateRequests, cacheKey])

  const create = async (): Promise<void> => {
    if (mutationPending.current) return
    mutationPending.current = true
    setMutating(true)
    try {
      const result = await wsClient.request({ type: 'team.conversation.create', teamId: team.id, title: '新团队会话' }) as { conversation?: Conversation }
      if (!result.conversation || !mounted.current) return
      await load(true)
      if (!mounted.current) return
      // 新建线仍显式选中新线（唯一保留的"替用户选线"路径，用户已确认保留）。
      onMasterSession(result.conversation.master_session_id)
      onSelect(result.conversation)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '创建会话失败')
    } finally {
      mutationPending.current = false
      if (mounted.current) setMutating(false)
    }
  }

  const confirmAction = async (title?: string): Promise<void> => {
    if (!dialog || mutationPending.current) return
    const { item, action } = dialog
    setDialog(null)
    if (action === 'rename' && (!title?.trim() || title.trim() === item.title)) return
    mutationPending.current = true
    setMutating(true)
    try {
      await wsClient.request({ type: `team.conversation.${action}`, conversationId: item.id, ...(action === 'rename' ? { title: title!.trim() } : {}) })
      if (!mounted.current) { teamListCache.delete(cacheKey); return }
      // Commit the successful mutation locally before refreshing; failure of the
      // subsequent read must not resurrect a deleted conversation.
      const next = (teamListCache.get(cacheKey) as Conversation[] || []).flatMap(row => row.id !== item.id ? [row]
        : action === 'delete' ? [] : [{ ...row, ...(action === 'rename' ? { title: title!.trim() } : { status: 'archived' }) }])
      teamListCache.set(cacheKey, next)
      setItems(next)
      if (selectedId.current === item.id) {
        const selected = next.find(row => row.id === item.id)
        // 归档当前线保持选中（选中对象刷新为归档态）；删除当前线才回空态。
        if (selected) onSelect(selected)
        else { onSelect(null); onMasterSession(null) }
      }
      await load(true)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      mutationPending.current = false
      if (mounted.current) setMutating(false)
    }
  }

  return (
    <aside data-hotkey-session-list data-hotkey-scope="list" style={asideStyle}>
      <div style={edgeStyle} />
      <header style={headerStyle}>
        <div style={headerAccentStyle} />
        <span style={teamIconStyle}><Bot size={12} /></span>
        <strong style={teamNameStyle} title={team.name}>{team.name}</strong>
        <button type="button" onClick={() => { void create() }} disabled={mutating} title="新建会话" style={newButtonStyle}><Plus size={14} /></button>
        <button type="button" onClick={() => void load()} disabled={loading} title="刷新" style={iconStyle}>{loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}</button>
      </header>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={listStyle}>
        {loading && items.length === 0 && <div style={stateStyle}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} /><div>正在加载会话...</div></div>}
        {!loading && !error && items.length === 0 && <div style={stateStyle}>暂无会话<br /><span style={{ fontSize: 12 }}>点击上方加号新建</span></div>}
        {rows.map((item) => {
          const activity = summary?.conversations.find(entry => entry.conversationId === item.id)
          // 绿点/未读点走公共判定：已归档线不参与（对齐徽标"总数含归档、在跑/未读不含归档"口径）。
          const { running, unread } = resolveTeamConversationIndicators(item, activity, runningSessionIds, sessionActivityStates)
          return (
            <SessionListRow
              key={item.id}
              sessionId={item.master_session_id}
              active={activeId === item.id}
              onSelect={() => { onMasterSession(item.master_session_id); onSelect(item) }}
              onContextMenu={event => { event.preventDefault(); setMenu({ item, x: event.clientX, y: event.clientY }) }}
            >
              <span title={running ? '正在执行' : unread ? '未读' : item.status === 'active' ? '空闲' : '已归档'} style={statusDotStyle(running, unread)} />
              <span style={titleStyle} title={item.title}>{item.title}</span>
              <span style={timeStyle}>{formatTime(activity?.lastMessageAt || item.last_message_at || item.updated_at || '')}</span>
            </SessionListRow>
          )
        })}
      </div>
      <ContextMenu open={!!menu} x={menu?.x || 0} y={menu?.y || 0} onClose={() => setMenu(null)} items={menu ? [
        { label: '重命名', disabled: mutating, onClick: () => setDialog({ item: menu.item, action: 'rename' }) },
        { label: '归档', disabled: mutating || menu.item.status !== 'active', onClick: () => setDialog({ item: menu.item, action: 'archive' }) },
        { label: '删除', danger: true, disabled: mutating, onClick: () => setDialog({ item: menu.item, action: 'delete' }) },
      ] : []} />
      <PromptDialog open={dialog?.action === 'rename'} title="重命名会话" defaultValue={dialog?.item.title || ''} placeholder="输入新的会话名称" onConfirm={value => { void confirmAction(value) }} onCancel={() => setDialog(null)} />
      <ConfirmDialog open={dialog?.action === 'archive' || dialog?.action === 'delete'} title={dialog?.action === 'delete' ? '删除团队会话' : '归档团队会话'} message={dialog?.action === 'delete' ? `确定删除“${dialog.item.title}”？该会话将从团队列表移除，成员的底层会话记录仍保留。` : `确定归档“${dialog?.item.title || ''}”？归档后不再参与团队运行和未读提醒。`} danger={dialog?.action === 'delete'} confirmLabel={dialog?.action === 'delete' ? '删除' : '归档'} onConfirm={() => { void confirmAction() }} onCancel={() => setDialog(null)} />
    </aside>
  )
}

const asideStyle: React.CSSProperties = { width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', position: 'relative' }
const edgeStyle: React.CSSProperties = { position: 'absolute', top: 0, right: 0, width: 1, height: '100%', background: 'linear-gradient(to bottom, transparent, var(--border) 10%, var(--border) 90%, transparent)', pointerEvents: 'none', zIndex: 1 }
const headerStyle: React.CSSProperties = { padding: '12px 14px 12px 17px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', flexShrink: 0, minWidth: 0, position: 'relative', background: 'var(--bg-1)' }
const headerAccentStyle: React.CSSProperties = { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--blue)' }
const teamIconStyle: React.CSSProperties = { width: 18, height: 18, borderRadius: 4, background: 'var(--blue)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const teamNameStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }
const listStyle: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }
const stateStyle: React.CSSProperties = { padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }
const errorStyle: React.CSSProperties = { margin: '8px 10px 4px', padding: '7px 9px', color: 'var(--red)', background: 'var(--red-light)', borderRadius: 6, fontSize: 12 }
const titleStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 400 }
const timeStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-3)', flexShrink: 0, marginLeft: 4 }
const iconStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 3, borderRadius: 4 }
const newButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 22, padding: '0 4px', border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', borderRadius: 4 }
const statusDotStyle = (running: boolean, unread: boolean): React.CSSProperties => ({ width: 6, height: 6, borderRadius: '50%', background: running ? 'var(--green)' : unread ? 'var(--yellow)' : 'var(--text-3)', flexShrink: 0, animation: running ? 'session-running-pulse 1s ease-in-out infinite' : undefined, boxShadow: running ? '0 0 0 4px rgba(5, 150, 105, 0.12)' : undefined })
