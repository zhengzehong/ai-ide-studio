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
  /** 内容版本号：重放合并 / 成员刷新落地时递增（见 ConversationMessageList 的再锚定 effect）。 */
  contentRevision: number
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
  markUnread?: () => Promise<void>
  senderAgentIds?: Record<string, string>
  /** 主停止（全队急停）目标会话：leader 在跑时排最前，其余为 running 成员；空闲会话不进列表。 */
  runningTurnSessionIds: string[]
  /** 本地定向待落账消息（成员起跑前先显示「排队中 · 等待空闲」）：直接追加到消息流尾部。 */
  directedPendingMessages?: ConversationAdapter['messages']
  /** 团队线目标胶囊 + 就地档位/权限控制（composer 可选插槽）。 */
  teamTarget?: ConversationAdapter['teamTarget']
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
    senderAgentIds: input.senderAgentIds,
    messages: [...input.aggregate.messages, ...(input.directedPendingMessages ?? [])], events: input.aggregate.events, contentRevision: input.contentRevision,
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
    // 主停止 = 全队急停：并发取消所有在跑会话（成员失败静默吞掉——可能刚好自然结束；leader 失败才抛给 composer 显示「停止失败」）。
    cancel: async () => {
      if (input.runningTurnSessionIds.length === 0) return
      const results = await Promise.allSettled(input.runningTurnSessionIds.map(sessionId =>
        commandClient.execute({ commandId: `team-cancel-${sessionId}-${Date.now()}`, type: 'session.cancel', sessionId })))
      const leaderIndex = input.masterSessionId ? input.runningTurnSessionIds.indexOf(input.masterSessionId) : -1
      if (leaderIndex >= 0 && results[leaderIndex].status === 'rejected') throw (results[leaderIndex] as PromiseRejectedResult).reason
    },
    loadOlderMessages: input.loadOlderMessages, reload: async () => { await input.reload() }, markUnread: input.markUnread,
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
    // 团队线目标（可选插槽）：不注入即普通会话，composer 零感知。
    teamTarget: input.teamTarget,
  }
}
