import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Archive, Trash2 } from 'lucide-react'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string; status: string; updated_at: string }
interface Props { team: TeamData; activeId: string | null; onSelect: (conversation: Conversation) => void; onMasterSession: (sessionId: string) => void }

export function TeamConversationList({ team, activeId, onSelect, onMasterSession }: Props) {
  const [items, setItems] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await wsClient.request({ type: 'team.conversation.list', teamId: team.id })
      setItems(Array.isArray(rows) ? rows as Conversation[] : [])
    } finally { setLoading(false) }
  }, [team.id])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  const create = async () => {
    const result = await wsClient.request({ type: 'team.conversation.create', teamId: team.id, title: '新团队会话' }) as { conversation?: Conversation }
    if (!result.conversation) return
    await load(); onMasterSession(result.conversation.master_session_id); onSelect(result.conversation)
  }
  const rename = async (item: Conversation) => {
    const title = window.prompt('重命名团队会话', item.title)?.trim()
    if (!title || title === item.title) return
    await wsClient.request({ type: 'team.conversation.rename', conversationId: item.id, title }); await load()
  }
  const archive = async (item: Conversation) => {
    if (!window.confirm(`归档“${item.title}”？`)) return
    await wsClient.request({ type: 'team.conversation.archive', conversationId: item.id }); await load()
  }
  const remove = async (item: Conversation) => {
    if (!window.confirm(`删除“${item.title}”？`)) return
    await wsClient.request({ type: 'team.conversation.delete', conversationId: item.id }); await load()
  }
  return <aside style={{ width: 270, borderRight: '1px solid var(--border)', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <div style={{ padding: '14px 12px 8px', fontWeight: 700 }}>团队会话</div>
    <button type="button" onClick={() => void create()} style={{ margin: '0 10px 8px', padding: '8px', border: '1px dashed var(--blue)', color: 'var(--blue)', background: 'transparent', borderRadius: 7, cursor: 'pointer' }}><Plus size={14} /> 新建会话</button>
    <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px' }}>{loading && <div style={{ padding: 12, color: 'var(--text-3)' }}>正在加载...</div>}{items.map((item) => <div key={item.id} onClick={() => { onMasterSession(item.master_session_id); onSelect(item) }} style={{ padding: '10px', marginBottom: 4, borderRadius: 7, background: activeId === item.id ? 'var(--blue-light)' : 'transparent', cursor: 'pointer' }}><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</b><button type="button" aria-label="重命名" onClick={(e) => { e.stopPropagation(); void rename(item) }} style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}><Pencil size={13} /></button><button type="button" aria-label="归档" onClick={(e) => { e.stopPropagation(); void archive(item) }} style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}><Archive size={13} /></button><button type="button" aria-label="删除" onClick={(e) => { e.stopPropagation(); void remove(item) }} style={{ border: 0, background: 'transparent', color: 'var(--red)', cursor: 'pointer' }}><Trash2 size={13} /></button></div><small style={{ color: 'var(--text-3)' }}>{new Date(item.updated_at).toLocaleString()}</small></div>)}</div>
  </aside>
}
