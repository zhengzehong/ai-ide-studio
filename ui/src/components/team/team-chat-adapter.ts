import type { ConversationAdapter, ConversationProcessState } from '../chat/conversation-types'
import type { FileChangeDetailInfo } from '../../stores/session-events'
import type { TeamData } from '../../stores/team.store'
import { commandClient } from '../../services/command-client'
import { wsClient } from '../../services/ws-client'
import type { aggregateSnapshots, Snapshot } from './team-chat-state'
import type { TeamConversation } from './team-view-cache'

interface TeamAdapterInput {
  team: TeamData
  conversation: TeamConversation | null
  masterSessionId: string | null
  aggregate: ReturnType<typeof aggregateSnapshots>
  snapshots: Record<string, Snapshot>
  loading: boolean
  error: string | null
  sending: boolean
  loadingOlder: boolean
  processByMessageId: Record<string, ConversationProcessState>
  fileChanges: Record<string, FileChangeDetailInfo>
  fileErrors: Record<string, string>
  processItemLoadingByKey: Record<string, boolean>
  processItemErrorByKey: Record<string, string>
  loadMessageProcess: ConversationAdapter['loadMessageProcess']
  loadFileChanges: ConversationAdapter['loadFileChanges']
  loadProcessItemDetail: ConversationAdapter['loadProcessItemDetail']
  sendPrompt: ConversationAdapter['sendPrompt']
  loadOlderMessages: ConversationAdapter['loadOlderMessages']
  reload: () => Promise<boolean>
}

export function resolveTeamInteractionSession(snapshots: Record<string, Snapshot>, kind: 'permissions' | 'elicitations', requestId: string): string {
  const source = Object.entries(snapshots).find(([, snapshot]) => snapshot[kind].some(request => request.id === requestId && !request.resolved))
  if (!source) throw new Error('交互请求已失效，请刷新会话')
  return source[0]
}

export function createTeamChatAdapter(input: TeamAdapterInput): ConversationAdapter {
  return {
    sessionId: input.masterSessionId, projectId: input.team.project_id,
    agentName: input.conversation ? `${input.team.name} · Master` : input.team.name,
    agentRuntime: 'team', sessionTitle: input.conversation?.title ?? null,
    messages: input.aggregate.messages, events: input.aggregate.events,
    streamingMessage: input.aggregate.streaming[0] || null, streamingMessages: input.aggregate.streaming,
    loading: input.loading, error: input.error, running: input.aggregate.running, sending: input.sending,
    connected: true, hasMoreMessages: input.aggregate.hasMore, loadingOlderMessages: input.loadingOlder,
    pendingPermissions: input.aggregate.permissions, pendingElicitations: input.aggregate.elicitations,
    interactionError: null, capabilities: input.aggregate.capabilities, usage: input.aggregate.usage,
    processByMessageId: input.processByMessageId, fileChangeDetailsByMessageId: input.fileChanges,
    fileChangeLoadingByKey: {},
    fileChangeErrorByKey: Object.fromEntries(Object.entries(input.fileErrors).map(([id, message]) => [`file:${id}`, message])),
    processItemLoadingByKey: input.processItemLoadingByKey, processItemErrorByKey: input.processItemErrorByKey,
    sendPrompt: input.sendPrompt,
    cancel: async () => { if (input.masterSessionId) await commandClient.execute({ commandId: `team-cancel-${input.masterSessionId}-${Date.now()}`, type: 'session.cancel', sessionId: input.masterSessionId }) },
    loadOlderMessages: input.loadOlderMessages, reload: async () => { await input.reload() },
    loadMessageProcess: input.loadMessageProcess, loadFileChanges: input.loadFileChanges,
    loadProcessItemDetail: input.loadProcessItemDetail,
    respondPermission: async (requestId, optionId, cancelled) => {
      const sessionId = resolveTeamInteractionSession(input.snapshots, 'permissions', requestId)
      await commandClient.execute({ commandId: `team-permission-${requestId}`, type: 'permission.respond', sessionId, permissionRequestId: requestId, optionId, cancelled })
    },
    respondElicitation: async (requestId, action, content) => {
      const sessionId = resolveTeamInteractionSession(input.snapshots, 'elicitations', requestId)
      await commandClient.execute({ commandId: `team-elicitation-${requestId}`, type: 'elicitation.respond', sessionId, elicitationRequestId: requestId, action, content })
    },
    setModel: async id => { if (input.masterSessionId) await wsClient.request({ type: 'session.setModel', sessionId: input.masterSessionId, modelId: id }) },
    setMode: async id => { if (input.masterSessionId) await wsClient.request({ type: 'session.setMode', sessionId: input.masterSessionId, modeId: id }) },
    setConfig: async (id, value) => { if (input.masterSessionId) await wsClient.request({ type: 'session.setConfig', sessionId: input.masterSessionId, configId: id, value }) },
  }
}
