import { useCallback, useEffect, useState } from 'react'
import { Archive, Bot, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'
import type { SessionIndicatorStateMap } from '../../utils/session-indicators'
import { isTeamConversationRunning } from './team-conversation-state'

interface Conversation {
  id: string
  team_id: string
  master_session_id: string
  title: string
  status: string
  updated_at: string
  activity_state?: 'running' | 'idle' | null
}

interface Props {
  team: TeamData
  activeId: string | null
  onSelect: (conversation: Conversation) => void
  onMasterSession: (sessionId: string) => void
  runningSessionIds?: SessionIndicatorStateMap
  sessionActivityStates?: Record<string, 'running' | 'idle' | undefined>
}

export function TeamConversationList({ team, activeId, onSelect, onMasterSession, runningSessionIds = {}, sessionActivityStates = {} }: Props) {
  const [items, setItems] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const rows = await wsClient.request({ type: 'team.conversation.list', teamId: team.id })
      setItems(Array.isArray(rows) ? rows as Conversation[] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '团队会话加载失败')
    } finally {
      setLoading(false)
    }
  }, [team.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const create = async (): Promise<void> => {
    try {
      const result = await wsClient.request({ type: 'team.conversation.create', teamId: team.id, title: '新团队会话' }) as { conversation?: Conversation }
      if (!result.conversation) return
      await load()
      onMasterSession(result.conversation.master_session_id)
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
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败')
    }
  }

  const archive = async (item: Conversation): Promise<void> => {
    if (!window.confirm(`归档“${item.title}”？`)) return
    try {
      await wsClient.request({ type: 'team.conversation.archive', conversationId: item.id })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '归档失败')
    }
  }

  const remove = async (item: Conversation): Promise<void> => {
    if (!window.confirm(`删除“${item.title}”？`)) return
    try {
      await wsClient.request({ type: 'team.conversation.delete', conversationId: item.id })
      await load()
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
        {items.map((item) => (
          <div
            key={item.id}
            data-session-id={item.master_session_id}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onMasterSession(item.master_session_id)
                onSelect(item)
              }
            }}
            onClick={() => { onMasterSession(item.master_session_id); onSelect(item) }}
            style={conversationRowStyle(activeId === item.id)}
          >
            <div style={rowMainStyle}>
              <span
                title={isTeamConversationRunning(item, runningSessionIds, sessionActivityStates) ? '正在执行' : item.status === 'active' ? '空闲' : '已归档'}
                style={statusDotStyle(isTeamConversationRunning(item, runningSessionIds, sessionActivityStates))}
              />
              <b style={titleStyle}>{item.title}</b>
              <button type="button" title="重命名" onClick={(event) => { event.stopPropagation(); void rename(item) }} style={iconStyle}><Pencil size={13} /></button>
              <button type="button" title="归档" onClick={(event) => { event.stopPropagation(); void archive(item) }} style={iconStyle}><Archive size={13} /></button>
              <button type="button" title="删除" onClick={(event) => { event.stopPropagation(); void remove(item) }} style={iconStyle}><Trash2 size={13} /></button>
            </div>
            <div style={timeStyle}>{formatTime(item.updated_at)}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
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
const rowMainStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }
const titleStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }
const timeStyle: React.CSSProperties = { marginTop: 3, marginLeft: 13, fontSize: 11, color: 'var(--text-3)' }
const iconStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 3, borderRadius: 4 }
const newButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 22, padding: '0 4px', border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', borderRadius: 4 }
const statusDotStyle = (running: boolean): React.CSSProperties => ({ width: 7, height: 7, borderRadius: '50%', background: running ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 })
const conversationRowStyle = (active: boolean): React.CSSProperties => ({ position: 'relative', padding: '6px 8px', margin: '0 6px 2px', borderRadius: 4, background: active ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', transition: 'background 0.15s', boxShadow: active ? 'inset 2px 0 0 var(--blue)' : 'none' })
