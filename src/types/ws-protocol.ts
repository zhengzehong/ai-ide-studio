export type AgentStatus = 'running' | 'idle' | 'standby' | 'sleeping' | 'error'
export type AgentRuntime = 'mock' | 'claude' | 'codex'
export type SessionStatus = 'active' | 'idle' | 'closed'
export type SessionActivityState = 'running' | 'idle'
export type SessionRuntimeState = SessionActivityState
export type SessionActivityReason =
  | 'prompt-started'
  | 'prompt-done'
  | 'prompt-error'
  | 'prompt-cancelled'
  | 'runtime-exit'
  | 'startup-recovery'
export type TaskStatus = 'backlog' | 'executing' | 'needs_input' | 'blocked' | 'reviewing' | 'completed' | 'cancelled'

export interface ClientMessage {
  type: string
  requestId?: string
  [key: string]: unknown
}

export interface SubscribeMsg extends ClientMessage {
  type: 'subscribe'
  sessionIds: string[]
}
export interface UnsubscribeMsg extends ClientMessage {
  type: 'unsubscribe'
  sessionIds: string[]
}
export interface PromptMsg extends ClientMessage {
  type: 'prompt'
  sessionId: string
  content: string
  clientMessageId?: string
  images?: ImageAttachment[]
}
export interface DecisionMsg extends ClientMessage {
  type: 'decision'
  sessionId: string
  messageId: string
  choice: string
}
export interface PermissionDecisionMsg extends ClientMessage {
  type: 'permission.respond'
  sessionId: string
  permissionRequestId: string
  optionId?: string
  cancelled?: boolean
}
export interface ElicitationDecisionMsg extends ClientMessage {
  type: 'elicitation.respond'
  sessionId: string
  elicitationRequestId: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, string | number | boolean | string[]>
}
export interface SetModelMsg extends ClientMessage {
  type: 'session.setModel'
  sessionId: string
  modelId: string
}
export interface GetModelsMsg extends ClientMessage {
  type: 'session.getModels'
  sessionId: string
}
export interface SetConfigMsg extends ClientMessage {
  type: 'session.setConfig'
  sessionId: string
  configId: string
  value: string | boolean
}
export interface SetModeMsg extends ClientMessage {
  type: 'session.setMode'
  sessionId: string
  modeId: string
}
export interface ForkSessionMsg extends ClientMessage {
  type: 'session.fork'
  sessionId: string
}
export interface AgentsListMsg extends ClientMessage {
  type: 'agents.list'
  projectId?: string
}
export interface AgentsCreateMsg extends ClientMessage {
  type: 'agents.create'
  name: string
  agentType: string
  runtime: AgentRuntime
}
export interface AgentsDeployTemplateMsg extends ClientMessage {
  type: 'agents.deployTemplate'
  projectId: string
  templateId: string
  name?: string
  runtime?: AgentRuntime
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}
export interface AgentsCreateCustomMsg extends ClientMessage {
  type: 'agents.createCustom'
  projectId: string
  name: string
  agentType: string
  runtime: AgentRuntime
  systemPrompt?: string
  icon?: string
  modelProfileId?: string
}
export interface AgentsUpdateMsg extends ClientMessage {
  type: 'agents.update'
  agentId: string
  name?: string
  agentType?: string
  runtime?: AgentRuntime
  systemPrompt?: string
  icon?: string
  modelProfileId?: string | null
}
export interface AgentsDeleteMsg extends ClientMessage {
  type: 'agents.delete'
  agentId: string
}
export interface GlobalAssistantGetMsg extends ClientMessage {
  type: 'globalAssistant.get'
}
export interface GlobalAssistantSetTemplateMsg extends ClientMessage {
  type: 'globalAssistant.setTemplate'
  templateId: string
}
export interface GlobalAssistantTouchMsg extends ClientMessage {
  type: 'globalAssistant.touch'
}
export interface SessionsListMsg extends ClientMessage {
  type: 'sessions.list'
  agentId?: string
  projectId?: string
}
export interface SessionsCreateMsg extends ClientMessage {
  type: 'sessions.create'
  agentId: string
  taskId?: string
  projectId?: string
}
export interface SessionsCopyMsg extends ClientMessage {
  type: 'sessions.copy'
  sessionId: string
}
export type LocalSessionImportRuntime = Extract<AgentRuntime, 'claude' | 'codex'>
export interface LocalSessionCandidateData {
  runtime: LocalSessionImportRuntime
  sessionId: string
  path: string
  label: string
  updatedAt: string
  cwd?: string
}
export interface SessionsListLocalImportCandidatesMsg extends ClientMessage {
  type: 'sessions.listLocalImportCandidates'
  agentId: string
  projectId?: string
  codexHome?: string
  claudeHome?: string
  limit?: number
}
export interface SessionsImportLocalMsg extends ClientMessage {
  type: 'sessions.importLocal'
  agentId: string
  projectId?: string
  jsonlPath?: string
  externalSessionId?: string
  sourcePath?: string
  runtime?: LocalSessionImportRuntime
  cwd?: string
  title?: string
}
export interface SessionsRenameMsg extends ClientMessage {
  type: 'sessions.rename'
  sessionId: string
  title: string
}
export interface SessionsDeleteMsg extends ClientMessage {
  type: 'sessions.delete'
  sessionId: string
}
export interface SessionsCloseMsg extends ClientMessage {
  type: 'sessions.close'
  sessionId: string
}
export interface SessionsArchiveMsg extends ClientMessage {
  type: 'sessions.archive'
  sessionId: string
}
export interface SessionsMessagesMsg extends ClientMessage {
  type: 'sessions.messages'
  sessionId: string
  limit?: number
  before?: string
  includeToolCalls?: boolean
  includeLatestToolCalls?: boolean
}
export interface SessionsMessageToolCallsMsg extends ClientMessage {
  type: 'sessions.messageToolCalls'
  sessionId: string
  messageId: string
}
export interface SessionsMessageToolCallDetailMsg extends ClientMessage {
  type: 'sessions.messageToolCallDetail'
  sessionId: string
  messageId: string
  toolCallId: string
}

export interface SessionsMessageFileChangesMsg extends ClientMessage {
  type: 'sessions.messageFileChanges'
  sessionId: string
  messageId: string
}
export interface SessionsMessageProcessMsg extends ClientMessage {
  type: 'sessions.messageProcess'
  sessionId: string
  messageId: string
}
export interface SessionsProcessItemDetailMsg extends ClientMessage {
  type: 'sessions.processItemDetail'
  sessionId: string
  messageId: string
  itemId: string
}
export interface SessionsMessageEventsMsg extends ClientMessage {
  type: 'sessions.messageEvents'
  sessionId: string
  messageId: string
}
export interface SessionsEventsMsg extends ClientMessage {
  type: 'sessions.events'
  sessionId: string
  limit?: number
  afterSequence?: number
}
export interface TasksListMsg extends ClientMessage {
  type: 'tasks.list'
  status?: TaskStatus
  projectId?: string
}
export interface TasksCreateMsg extends ClientMessage {
  type: 'tasks.create'
  title: string
  description?: string
  assignAgentId?: string
  projectId?: string
}
export interface TasksUpdateMsg extends ClientMessage {
  type: 'tasks.update'
  taskId: string
  status?: TaskStatus
  stage?: string
}
export interface TeamsCurrentMsg extends ClientMessage {
  type: 'teams.current'
  sessionId: string
}
export interface RulesListMsg extends ClientMessage {
  type: 'rules.list'
}
export interface RulesCreateMsg extends ClientMessage {
  type: 'rules.create'
  name: string
  cron: string
  action: string
  actionConfig: { title: string; description?: string; assignAgentId?: string }
  description?: string
  enabled?: boolean
}
export interface RulesUpdateMsg extends ClientMessage {
  type: 'rules.update'
  ruleId: string
  name?: string
  cron?: string
  action?: string
  actionConfig?: Record<string, unknown>
  description?: string
  enabled?: boolean
}
export interface RulesToggleMsg extends ClientMessage {
  type: 'rules.toggle'
  ruleId: string
  enabled: boolean
}
export interface RulesDeleteMsg extends ClientMessage {
  type: 'rules.delete'
  ruleId: string
}

export interface ImageAttachment {
  data: string
  mimeType: string
  name?: string
}

export interface ToolCallData {
  id: string
  title: string
  kind?: string
  status?: string
  locations?: { path: string; line?: number }[]
  rawInput?: unknown
  rawOutput?: unknown
  content?: ToolCallContentItem[]
  terminalOutput?: string
  terminalOutputDelta?: string
  progress?: string[]
  progressDelta?: string
  error?: string
}


export interface ToolCallSummaryData {
  id: string
  title: string
  kind?: string
  status?: string
  hasRawInput: boolean
  hasRawOutput: boolean
  hasTerminalOutput: boolean
  outputPreview?: string
  error?: string
}

export interface ToolCallDetailData {
  id: string
  title: string
  kind?: string
  status?: string
  locations?: { path: string; line?: number }[]
  rawInputPreview?: string
  rawInputTruncated?: boolean
  rawOutputPreview?: string
  rawOutputTruncated?: boolean
  terminalOutputTail?: string
  terminalOutputTruncated?: boolean
  contentPreview?: ToolCallContentItem[]
  contentTruncated?: boolean
  progressTail?: string[]
  progressTruncated?: boolean
  error?: string
}

export interface FileChangeLineData {
  type: 'add' | 'del' | 'ctx'
  text: string
  oldLine?: number
  newLine?: number
}

export interface FileChangeSummaryEntryData {
  path: string
  changeType: 'A' | 'M' | 'D' | '?'
  addedLines: number
  deletedLines: number
}

export interface FileChangeSegmentData {
  toolCallId: string
  oldText?: string
  newText: string
  addedLines: number
  deletedLines: number
  lines: FileChangeLineData[]
}

export interface FileChangeDetailEntryData extends FileChangeSummaryEntryData {
  segments: FileChangeSegmentData[]
}

export interface FileChangeSummaryData {
  files: FileChangeSummaryEntryData[]
  totalAdded: number
  totalDeleted: number
}

export interface FileChangeDetailData {
  files: FileChangeDetailEntryData[]
  totalAdded: number
  totalDeleted: number
}

export interface MessageData {
  id: string
  session_id: string
  role: string
  content: string
  thinking: string | null
  tool_calls_json: string | null
  decision_json: string | null
  attachments_json: string | null
  file_changes_json: string | null
  status?: string
  started_at?: string | null
  completed_at?: string | null
  stats_json?: string | null
  process_item_count?: number
  timestamp: string
  has_tool_calls?: boolean
  tool_call_count?: number
  has_file_changes?: boolean
  file_change_count?: number
}

export interface TurnProcessItemData {
  id: string
  session_id: string
  message_id: string
  sequence: number
  kind: string
  status: string | null
  title: string | null
  summary: string | null
  preview: string | null
  content: string | null
  detail_json?: string | null
  meta_json: string | null
  created_at: string
  updated_at: string
  has_detail?: boolean
}
export interface ToolCallContentItem {
  type: 'text' | 'diff' | 'terminal'
  text?: string
  path?: string
  oldText?: string
  newText?: string
  terminalId?: string
}

export interface UsageData {
  contextSize: number
  contextUsed: number
  costAmount?: number
  costCurrency?: string
}

export interface TurnUsageData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedReadTokens?: number
  thoughtTokens?: number
}

export type SessionStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | 'error'

export interface SessionDoneData {
  sessionId: string
  agentId: string
  messageId: string
  turnId?: string
  turnUsage?: TurnUsageData
  stopReason?: SessionStopReason
  error?: string
}

export interface ModelInfo {
  modelId: string
  name: string
  description?: string
}

export interface ModeInfo {
  modeId: string
  name: string
  description?: string
}

export interface PlanEntry {
  content: string
  status: string
  priority: string
}

export interface ConfigOptionInfo {
  id: string
  name: string
  description?: string
  category?: string
  type: 'select' | 'boolean' | string
  currentValue?: string | boolean
  options?: { value: string; name: string; description?: string; group?: string }[]
}

export interface AvailableCommandInfo {
  name: string
  description: string
  input?: { hint: string } | null
}

export interface SessionInfoData {
  title?: string
  updatedAt?: string
}

export interface PermissionRequestData {
  id: string
  toolCall: ToolCallData
  options: { optionId: string; name: string; kind: string }[]
}

export interface ElicitationRequestData {
  id: string
  toolCallId?: string
  message?: string
  requestedSchema?: unknown
}

export interface SessionEventData {
  id: string
  session_id: string
  agent_id?: string | null
  acp_session_id?: string | null
  message_id?: string | null
  type: string
  role?: string | null
  payload_json: string
  sequence: number
  created_at: string
}

export interface SessionActivityData {
  sessionId: string
  agentId: string
  turnId?: string
  state: SessionActivityState
  reason: SessionActivityReason
  timestamp: string
}

export interface SessionCapabilities {
  models?: ModelInfo[]
  currentModelId?: string
  modes?: ModeInfo[]
  currentModeId?: string
  supportsImages?: boolean
  supportsAudio?: boolean
  configOptions?: ConfigOptionInfo[]
  commands?: AvailableCommandInfo[]
  sessionInfo?: SessionInfoData
}

export interface SessionUpdateData {
  messageId: string
  role: 'agent' | 'system'
  contentDelta?: string
  content?: string
  thinking?: string
  toolCall?: ToolCallData
  toolCallUpdate?: ToolCallData
  usage?: UsageData
  turnUsage?: TurnUsageData
  plan?: PlanEntry[]
  configOptions?: ConfigOptionInfo[]
  commands?: AvailableCommandInfo[]
  sessionInfo?: SessionInfoData
  permissionRequest?: PermissionRequestData
  elicitationRequest?: ElicitationRequestData
  attachments?: ImageAttachment[]
  eventType?: string
  done?: boolean
}

export type ServerMessage =
  | { type: 'session:update'; sessionId: string; agentId: string; data: SessionUpdateData }
  | { type: 'session:process_item'; sessionId: string; agentId?: string | null; item: TurnProcessItemData }
  | { type: 'session:event'; sessionId: string; agentId?: string | null; event: SessionEventData }
  | ({ type: 'session:done' } & SessionDoneData)
  | ({ type: 'session:activity' } & SessionActivityData)
  | { type: 'session:capabilities'; sessionId: string; capabilities: SessionCapabilities }
  | { type: 'session:changed'; sessionId: string; data: Record<string, unknown> }
  | { type: 'session:copy_failed'; sourceSessionId: string; targetSessionId: string; message: string }
  | { type: 'agent:status'; agentId: string; status: AgentStatus }
  | { type: 'task:update'; taskId: string; data: Record<string, unknown> }
  | { type: 'team:update'; teamId: string; sessionIds: string[]; data: Record<string, unknown> }
  | { type: 'rule:update'; ruleId: string; data: Record<string, unknown> }
  | { type: 'timeline:updated'; sessionId: string }
  | { type: 'event-center:update'; data: Record<string, unknown> }
  | { type: 'result'; requestId?: string; data: unknown }
  | { type: 'error'; requestId?: string; message: string }
