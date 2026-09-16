import type { OpenChatResource } from '../../services/chat-resource-links'
import type {
  ElicitationRequestInfo,
  FileChangeDetailInfo,
  FilesPresentationInfo,
  ImageAttachmentInfo,
  MessageData,
  PermissionRequestInfo,
  PreviewPresentationInfo,
  SessionCapabilities,
  SessionEventData,
  StreamingMessage,
  UsageInfo,
} from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'

export interface ConversationUploadedFile {
  id: string
  name: string
  mimeType: string
  size: number
  path: string
  relativePath: string
}

export interface ConversationProcessState {
  blocks: TurnProcessBlock[]
  loading: boolean
  loaded: boolean
  error?: string
}

/** 团队线目标成员（定向发送 + 就地档位/权限控制的能力来源）。 */
export interface ConversationTeamTargetMember {
  id: string
  name: string
  sessionId: string
  runtime: string
  model: string
  running: boolean
  /** 该成员已排队的定向消息数（前端按派发回执记账；真实 FIFO 在服务端）。 */
  queued: number
  /** 成员会话的 capabilities：档位/权限菜单唯一能力源（严禁写不存在的 configId）。 */
  capabilities: SessionCapabilities
}

/**
 * 团队线专属：目标胶囊 + 就地档位/权限控制。
 * **可选插槽**——不注入（普通会话）时 composer 行为与现状完全一致。
 */
export interface ConversationTeamTargetControls {
  members: ConversationTeamTargetMember[]
  /** null = 全体（消息发往 Master，与现状一致）。 */
  targetId: string | null
  onSelect: (memberId: string | null) => void
  /** 定向发送（绕过 Master 编排）；返回后端受理状态：queued=成员在跑，已排队等待空闲。 */
  sendDirected: (memberId: string, content: string) => Promise<'accepted' | 'queued'>
  /** 就地档位写入：写目标成员会话的档位 configOption（session.setConfig）。 */
  setTargetConfig: (memberId: string, configId: string, value: string | boolean) => Promise<void>
  /** 权限「跳转工具权限设置并预选该成员」（P0 只做展示+跳转，不做就地编辑）。 */
  openToolPermissions: (memberId: string) => void
}

export interface ConversationAdapter {
  compactProcess?: boolean
  sessionId: string | null
  projectId?: string | null
  agentName?: string | null
  agentRuntime?: string | null
  senderAgentIds?: Record<string, string>
  sessionTitle?: string | null
  messages: MessageData[]
  events?: SessionEventData[]
  /** 内容版本号：重放合并 / 刷新导致既有条目内容整体落地时递增（条目数不变也要能触发再锚定）。 */
  contentRevision?: number
  streamingMessage: StreamingMessage | null
  streamingMessages?: StreamingMessage[]
  loading: boolean
  error: string | null
  running: boolean
  sending: boolean
  stopping?: boolean
  stopError?: string | null
  connected?: boolean
  currentSessionCopying?: boolean
  hasMoreMessages: boolean
  loadingOlderMessages: boolean
  pendingPermissions: PermissionRequestInfo[]
  pendingElicitations: ElicitationRequestInfo[]
  interactionError: string | null
  capabilities: SessionCapabilities
  usage: UsageInfo | null
  processByMessageId?: Record<string, ConversationProcessState>
  fileChangeDetailsByMessageId?: Record<string, FileChangeDetailInfo>
  fileChangeLoadingByKey?: Record<string, boolean>
  fileChangeErrorByKey?: Record<string, string>
  processItemLoadingByKey?: Record<string, boolean>
  processItemErrorByKey?: Record<string, string>
  sendPrompt: (content: string, images?: ImageAttachmentInfo[], files?: ConversationUploadedFile[]) => Promise<void>
  cancel: () => Promise<void>
  loadOlderMessages: () => Promise<void>
  reload?: () => Promise<void>
  markUnread?: () => Promise<void>
  loadMessageProcess: (messageId: string) => Promise<void>
  loadFileChanges: (messageId: string) => Promise<void>
  loadProcessItemDetail: (messageId: string, itemId: string) => Promise<void>
  setModel?: (modelId: string) => Promise<void>
  setMode?: (modeId: string) => Promise<void>
  setConfig?: (configId: string, value: string | boolean) => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
  /** 团队线目标胶囊/就地档位与权限（可选插槽）：普通会话不注入，零感知。 */
  teamTarget?: ConversationTeamTargetControls
}

export interface ConversationPaneProps {
  compactTeam?: boolean
  adapter: ConversationAdapter
  onOpenPreview?: (preview: PreviewPresentationInfo) => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
  onOpenResource?: OpenChatResource
  onTogglePin?: () => void
  pinned?: boolean
}
