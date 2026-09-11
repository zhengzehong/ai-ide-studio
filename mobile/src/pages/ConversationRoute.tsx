import { useEffect, useMemo, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TeamChatPane } from '@desktop/components/team/TeamChatPane'
import type { TeamData } from '@desktop/stores/team.store'
import ChatPage from './ChatPage'
import { useConversationCatalog } from '../stores/conversation-catalog.store'
import { MobileTeamChatSurface } from '../components/chat/MobileTeamChatSurface'

export function ConversationRoute(): ReactElement {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { catalog, loaded, error, load, epoch } = useConversationCatalog()
  useEffect(() => { if (!loaded) void load() }, [loaded, load])
  const item = catalog.conversations.find(conversation => conversation.masterSessionId === sessionId)
  const owner = catalog.teams.find(team => team.id === item?.teamId)
  useEffect(() => {
    useConversationCatalog.getState().setActiveConversation(item?.id ?? null)
    return () => useConversationCatalog.getState().setActiveConversation(null)
  }, [item?.id])
  const conversation = useMemo(() => item ? { id: item.id, team_id: item.teamId, master_session_id: item.masterSessionId, title: item.title } : null, [item?.id, item?.teamId, item?.masterSessionId, item?.title])
  const team = useMemo<TeamData | null>(() => owner ? {
    id: owner.id, project_id: owner.projectId, name: owner.name, description: null,
    status: 'active', created_at: '', updated_at: '', archived_at: null,
  } : null, [owner?.id, owner?.name, owner?.projectId])
  if (sessionId === 'new') return <ChatPage />
  if (!loaded) return <div role="status" style={{ padding: 20 }}>{error || '加载会话…'}{error && <button onClick={() => { void load() }}>重试</button>}<button onClick={() => navigate('/')}>返回会话列表</button></div>
  if (team && conversation) return <TeamChatPane cacheScope={`mobile-${epoch}`} team={team} conversation={conversation} masterSessionId={conversation.master_session_id} renderSurface={adapter => <MobileTeamChatSurface adapter={adapter} />} />
  if (sessionId && catalog.hiddenSessionIds.includes(sessionId)) return <div style={{ padding: 20 }}>该团队会话已归档或不可用。<button onClick={() => navigate('/')}>返回会话列表</button></div>
  return <ChatPage />
}
