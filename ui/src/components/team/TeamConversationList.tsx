import { useCallback, useEffect, useState } from 'react'
import { Archive, Bot, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string; status: string; updated_at: string }
interface Props { team: TeamData; activeId: string | null; onSelect: (conversation: Conversation) => void; onMasterSession: (sessionId: string) => void }

export function TeamConversationList({ team, activeId, onSelect, onMasterSession }: Props) {
  const [items, setItems] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const rows = await wsClient.request({ type: 'team.conversation.list', teamId: team.id }); setItems(Array.isArray(rows) ? rows as Conversation[] : []) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '团队会话加载失败') }
    finally { setLoading(false) }
  }, [team.id])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  const create = async (): Promise<void> => { try { const result = await wsClient.request({ type: 'team.conversation.create', teamId: team.id, title: '新团队会话' }) as { conversation?: Conversation }; if (!result.conversation) return; await load(); onMasterSession(result.conversation.master_session_id); onSelect(result.conversation) } catch (cause) { setError(cause instanceof Error ? cause.message : '创建会话失败') } }
  const rename = async (item: Conversation): Promise<void> => { const title = window.prompt('重命名团队会话', item.title)?.trim(); if (!title || title === item.title) return; try { await wsClient.request({ type: 'team.conversation.rename', conversationId: item.id, title }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : '重命名失败') } }
  const archive = async (item: Conversation): Promise<void> => { if (!window.confirm(`归档“${item.title}”？`)) return; try { await wsClient.request({ type: 'team.conversation.archive', conversationId: item.id }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : '归档失败') } }
  const remove = async (item: Conversation): Promise<void> => { if (!window.confirm(`删除“${item.title}”？`)) return; try { await wsClient.request({ type: 'team.conversation.delete', conversationId: item.id }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败') } }
  return <aside data-hotkey-session-list data-hotkey-scope="list" style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <header style={{ minHeight: 47, padding: '10px 14px 10px 17px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' }}><span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--purple)', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Bot size={12} /></span><strong style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</strong><button type="button" onClick={() => void create()} disabled={loading} title="新建会话" style={iconStyle}><Plus size={15} /></button><button type="button" onClick={() => void load()} disabled={loading} title="刷新" style={iconStyle}>{loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}</button></header>
    {error && <div role="alert" style={{ margin: '0 10px 8px', padding: '8px 10px', color: 'var(--red)', background: 'var(--red-light)', borderRadius: 6, fontSize: 12 }}>{error}</div>}
    <div style={{ overflowY: 'auto', flex: 1, padding: '6px 6px 8px' }}>{loading && items.length === 0 && <div style={{ padding: 12, color: 'var(--text-3)' }}>正在加载...</div>}{!loading && !error && items.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>暂无团队会话</div>}{items.map((item) => <div key={item.id} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') { onMasterSession(item.master_session_id); onSelect(item) } }} onClick={() => { onMasterSession(item.master_session_id); onSelect(item) }} style={{ padding: '8px 8px 7px', marginBottom: 2, borderRadius: 6, background: activeId === item.id ? 'var(--blue-light)' : 'transparent', cursor: 'pointer' }}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: item.status === 'active' ? 'var(--green)' : 'var(--text-3)', flexShrink: 0 }} title={item.status === 'active' ? '进行中' : '已归档'} /><b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>{item.title}</b><button type="button" title="重命名" onClick={(event) => { event.stopPropagation(); void rename(item) }} style={iconStyle}><Pencil size={13} /></button><button type="button" title="归档" onClick={(event) => { event.stopPropagation(); void archive(item) }} style={iconStyle}><Archive size={13} /></button><button type="button" title="删除" onClick={(event) => { event.stopPropagation(); void remove(item) }} style={iconStyle}><Trash2 size={13} /></button></div><div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, marginLeft: 13 }}>{formatTime(item.updated_at)}</div></div>)}</div>
  </aside>
}
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString() }
const iconStyle = { border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 3, display: 'inline-flex' }
