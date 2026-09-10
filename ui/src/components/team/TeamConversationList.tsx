import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Bot, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import type { SessionIndicatorStateMap } from '../../utils/session-indicators'
import { isTeamConversationRunning, teamConversationListNeedsRefresh } from './team-conversation-state'
import { formatTime } from '../../pages/workspace/helpers'
import { SessionListRow } from '../session/SessionListRow'
import { useProjectSessionStatsStore } from '../../stores/project-session-stats.store'
import { teamCacheKey, teamListCache, teamSelectionCache, shareTeamRequest, invalidateTeamRequest, newTeamRequestScope } from './team-view-cache'

interface Conversation {
  id: string
  team_id: string
  master_session_id: string
  title: string
  status: string
  updated_at: string
  activity_state?: 'running' | 'idle' | null
  grid_session_ids?: string[] | null
  unread?: boolean
  last_message_at?: string | null
}

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
  const invalidateRequests = useCallback((): void => { requestSeq.current++ }, [])
  const summary = useProjectSessionStatsStore(state => state.statsByProjectId[team.project_id]?.teams?.find(item => item.teamId === team.id))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const load = useCallback(async (force = false): Promise<void> => {
    if (!mounted.current) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const requestKey = `list:${cacheKey}:${requestScope}`
      if (force) invalidateTeamRequest(requestKey)
      const rows = await shareTeamRequest(requestKey, () => wsClient.request({ type: 'team.conversation.list', teamId: team.id }))
      if (seq !== requestSeq.current) return
      const next = Array.isArray(rows) ? rows as Conversation[] : []
      teamListCache.set(cacheKey, next)
      setItems(next)
      const remembered = teamSelectionCache.get(cacheKey)
      if (remembered && !next.some(item => item.id === remembered.id)) { teamSelectionCache.delete(cacheKey); onMasterSession(null); onSelect(null) }
      const selected = next.find(item => item.id === remembered?.id)
      if (selected) {
        teamSelectionCache.set(cacheKey, selected)
        if (selected.title !== remembered?.title) onSelect(selected)
      }
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
    return () => { mounted.current = false; window.clearTimeout(timer); window.clearTimeout(refreshTimer); invalidateRequests(); off(); offTeam() }
  }, [load, team.id, invalidateRequests])

  // 点开团队时还没有选中的会话线:自动选中正在执行的一条,否则选最近更新的活跃线,避免只见空态。
  useEffect(() => {
    if (items.length === 0 || (activeId !== null && items.some(item => item.id === activeId))) return
    const remembered = teamSelectionCache.get(cacheKey)
    const best = items.find(item => item.id === remembered?.id)
      ?? items.find((item) => isTeamConversationRunning(item, runningSessionIds, sessionActivityStates))
      ?? [...items].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.updated_at.localeCompare(a.updated_at))[0]
    if (!best) return
    teamSelectionCache.set(cacheKey, best)
    onMasterSession(best.master_session_id)
    onSelect(best)
  }, [activeId, items, loading, onMasterSession, onSelect, runningSessionIds, sessionActivityStates, cacheKey])

  const create = async (): Promise<void> => {
    try {
      const result = await wsClient.request({ type: 'team.conversation.create', teamId: team.id, title: '新团队会话' }) as { conversation?: Conversation }
      if (!result.conversation || !mounted.current) return
      await load(true)
      if (!mounted.current) return
      onMasterSession(result.conversation.master_session_id)
      teamSelectionCache.set(cacheKey, result.conversation)
      onSelect(result.conversation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建会话失败')
    }
  }

  const rename = async (item: Conversation): Promise<void> => {
    const title = window.prompt('重命名团队会话', item.title)?.trim()
    if (!title || title === item.title) return
    try {
      await wsClient.request({ type: 'team.conversation.rename', conversationId: item.id, title })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败')
    }
  }

  const archive = async (item: Conversation): Promise<void> => {
    if (!window.confirm(`归档“${item.title}”？`)) return
    try {
      await wsClient.request({ type: 'team.conversation.archive', conversationId: item.id })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '归档失败')
    }
  }

  const remove = async (item: Conversation): Promise<void> => {
    if (!window.confirm(`删除“${item.title}”？`)) return
    try {
      await wsClient.request({ type: 'team.conversation.delete', conversationId: item.id })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  return (
    <aside data-hotkey-session-list data-hotkey-scope="list" style={asideStyle}>
      <div style={edgeStyle} />
      <header style={headerStyle}>
        <div style={headerAccentStyle} />
        <span style={teamIconStyle}><Bot size={12} /></span>
        <strong style={teamNameStyle} title={team.name}>{team.name}</strong>
        <button type="button" onClick={() => { void create() }} disabled={loading} title="新建会话" style={newButtonStyle}><Plus size={14} /></button>
        <button type="button" onClick={() => void load()} disabled={loading} title="刷新" style={iconStyle}>{loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}</button>
      </header>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={listStyle}>
        {loading && items.length === 0 && <div style={stateStyle}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} /><div>正在加载会话...</div></div>}
        {!loading && !error && items.length === 0 && <div style={stateStyle}>暂无会话<br /><span style={{ fontSize: 12 }}>点击上方加号新建</span></div>}
        {items.map((item) => {
          const activity = summary?.conversations.find(entry => entry.conversationId === item.id)
          const running = activity?.running ?? isTeamConversationRunning(item, runningSessionIds, sessionActivityStates)
          const unread = activity?.unread ?? item.unread ?? false
          return (
            <SessionListRow
              key={item.id}
              sessionId={item.master_session_id}
              active={activeId === item.id}
              onSelect={() => { teamSelectionCache.set(cacheKey, item); onMasterSession(item.master_session_id); onSelect(item) }}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId((current) => current === item.id ? null : current)}
              actions={hoveredId === item.id ? (
                <>
                  <button type="button" title="重命名" aria-label={`重命名 ${item.title}`} onClick={(event) => { event.stopPropagation(); void rename(item) }} style={iconStyle}><Pencil size={13} /></button>
                  <button type="button" title="归档" aria-label={`归档 ${item.title}`} onClick={(event) => { event.stopPropagation(); void archive(item) }} style={iconStyle}><Archive size={13} /></button>
                  <button type="button" title="删除" aria-label={`删除 ${item.title}`} onClick={(event) => { event.stopPropagation(); void remove(item) }} style={iconStyle}><Trash2 size={13} /></button>
                </>
              ) : undefined}
            >
              <span title={running ? '正在执行' : unread ? '未读' : item.status === 'active' ? '空闲' : '已归档'} style={statusDotStyle(running, unread)} />
              <span style={titleStyle} title={item.title}>{item.title}</span>
              <span style={timeStyle}>{formatTime(activity?.lastMessageAt || item.last_message_at || item.updated_at)}</span>
            </SessionListRow>
          )
        })}
      </div>
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
