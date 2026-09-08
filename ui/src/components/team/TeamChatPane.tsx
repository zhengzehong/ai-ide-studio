import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConversationPane } from '../chat/ConversationPane'
import type { ConversationAdapter } from '../chat/conversation-types'
import type { ImageAttachmentInfo, MessageData, SessionCapabilities, UsageInfo } from '../../stores/session-events'
import { queryClient } from '../../services/query-client'
import { wsClient } from '../../services/ws-client'
import type { TeamData } from '../../stores/team.store'

interface Conversation { id: string; team_id: string; master_session_id: string; title: string }
interface Member { id: string; agent_id: string; session_id: string; name: string; role: string }
interface Props { team: TeamData; conversation: Conversation | null; masterSessionId: string | null }

const defaultCapabilities: SessionCapabilities = { models: [], currentModelId: null, modes: [], currentModeId: null, supportsImages: false, configOptions: [], commands: [] }

export function TeamChatPane({ team, conversation, masterSessionId }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [messages, setMessages] = useState<MessageData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const sessionIds = useMemo(() => [masterSessionId, ...members.map((member) => member.session_id)].filter((id): id is string => !!id), [masterSessionId, members])

  const load = useCallback(async () => {
    if (!conversation) { setMembers([]); setMessages([]); return }
    setLoading(true); setError(null)
    try {
      const detail = await wsClient.request({ type: 'team.conversation.history', conversationId: conversation.id }) as { members?: Member[] }
      const nextMembers = Array.isArray(detail.members) ? detail.members : []
      setMembers(nextMembers)
      const ids = [conversation.master_session_id, ...nextMembers.map((member) => member.session_id)].filter((id): id is string => !!id)
      const pages = await Promise.all(ids.map((sessionId) => queryClient.listSessionMessages({ sessionId, limit: 120, includeToolCalls: true })))
      const labels = new Map<string, { name: string; role: string }>([[conversation.master_session_id, { name: 'Master', role: 'Master' }]])
      for (const member of nextMembers) labels.set(member.session_id, { name: member.name, role: member.role })
      const merged = pages.flatMap((page) => page.items.map((message) => {
        const label = labels.get(message.session_id)
        return label ? { ...message, session_id: conversation.master_session_id, sender_name: label.name, sender_role: label.role } : message
      }))
      merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
      setMessages(merged)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '团队消息加载失败') }
    finally { setLoading(false) }
  }, [conversation])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load, sessionIds])
  useEffect(() => {
    const dispose = wsClient.on('session:update', (msg) => {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : ''
      if (sessionIds.includes(sessionId)) void load()
    })
    return () => { dispose?.() }
  }, [load, sessionIds])

  const sendPrompt = useCallback(async (content: string) => {
    if (!masterSessionId) throw new Error('团队暂无 Master 会话')
    setSending(true)
    try { await wsClient.request({ type: 'prompt', sessionId: masterSessionId, content }); await load() }
    finally { setSending(false) }
  }, [load, masterSessionId])

  const adapter = useMemo<ConversationAdapter>(() => createAdapter({ team, conversation, masterSessionId, messages, loading, error, sending, sendPrompt, reload: load }), [conversation, error, loading, load, masterSessionId, messages, sendPrompt, sending, team])
  return <ConversationPane adapter={adapter} />
}

function createAdapter(input: { team: TeamData; conversation: Conversation | null; masterSessionId: string | null; messages: MessageData[]; loading: boolean; error: string | null; sending: boolean; sendPrompt: (content: string, images?: ImageAttachmentInfo[]) => Promise<void>; reload: () => Promise<void> }): ConversationAdapter {
  const noOp = async (): Promise<void> => undefined
  return {
    sessionId: input.masterSessionId,
    projectId: input.team.project_id,
    agentName: input.conversation ? `${input.team.name} · Master` : input.team.name,
    agentRuntime: 'team',
    sessionTitle: input.conversation?.title ?? null,
    messages: input.messages,
    streamingMessage: null,
    loading: input.loading,
    error: input.error,
    running: false,
    sending: input.sending,
    connected: true,
    hasMoreMessages: false,
    loadingOlderMessages: false,
    pendingPermissions: [],
    pendingElicitations: [],
    interactionError: null,
    capabilities: defaultCapabilities,
    usage: null as UsageInfo | null,
    sendPrompt: input.sendPrompt,
    cancel: noOp,
    loadOlderMessages: noOp,
    reload: input.reload,
    loadMessageProcess: noOp,
    loadFileChanges: noOp,
    loadProcessItemDetail: noOp,
    respondPermission: async () => undefined,
    respondElicitation: async () => undefined,
  }
}
