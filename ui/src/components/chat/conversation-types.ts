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

export interface ConversationAdapter {
  sessionId: string | null
  projectId?: string | null
  agentName?: string | null
  agentRuntime?: string | null
  sessionTitle?: string | null
  messages: MessageData[]
  events?: SessionEventData[]
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
  loadMessageProcess: (messageId: string) => Promise<void>
  loadFileChanges: (messageId: string) => Promise<void>
  loadProcessItemDetail: (messageId: string, itemId: string) => Promise<void>
  setModel?: (modelId: string) => Promise<void>
  setMode?: (modeId: string) => Promise<void>
  setConfig?: (configId: string, value: string | boolean) => Promise<void>
  respondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  respondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
}

export interface ConversationPaneProps {
  adapter: ConversationAdapter
  onOpenPreview?: (preview: PreviewPresentationInfo) => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
  onOpenResource?: OpenChatResource
  onTogglePin?: () => void
  pinned?: boolean
}
