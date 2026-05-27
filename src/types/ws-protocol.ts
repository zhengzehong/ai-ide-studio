export type AgentStatus = 'running' | 'idle' | 'standby' | 'sleeping' | 'error'
export type AgentRuntime = 'mock' | 'claude' | 'codex'
export type SessionStatus = 'active' | 'idle' | 'closed'
export type TaskStatus = 'backlog' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'cancelled' | 'blocked'

export interface ClientMessage {
  type: string
  requestId?: string
  [key: string]: unknown
}

export interface SubscribeMsg extends ClientMessage { type: 'subscribe'; sessionIds: string[] }
export interface UnsubscribeMsg extends ClientMessage { type: 'unsubscribe'; sessionIds: string[] }
export interface PromptMsg extends ClientMessage { type: 'prompt'; sessionId: string; content: string; images?: ImageAttachment[] }
export interface DecisionMsg extends ClientMessage { type: 'decision'; sessionId: string; messageId: string; choice: string }
export interface PermissionDecisionMsg extends ClientMessage { type: 'permission.respond'; sessionId: string; permissionRequestId: string; optionId?: string; cancelled?: boolean }
export interface ElicitationDecisionMsg extends ClientMessage { type: 'elicitation.respond'; sessionId: string; elicitationRequestId: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean | string[]> }
export interface SetModelMsg extends ClientMessage { type: 'session.setModel'; sessionId: string; modelId: string }
export interface GetModelsMsg extends ClientMessage { type: 'session.getModels'; sessionId: string }
export interface SetConfigMsg extends ClientMessage { type: 'session.setConfig'; sessionId: string; configId: string; value: string | boolean }
export interface SetModeMsg extends ClientMessage { type: 'session.setMode'; sessionId: string; modeId: string }
export interface ForkSessionMsg extends ClientMessage { type: 'session.fork'; sessionId: string }
export interface AgentsListMsg extends ClientMessage { type: 'agents.list' }
export interface AgentsCreateMsg extends ClientMessage { type: 'agents.create'; name: string; agentType: string; runtime: AgentRuntime }
export interface SessionsListMsg extends ClientMessage { type: 'sessions.list'; agentId?: string }
export interface SessionsCreateMsg extends ClientMessage { type: 'sessions.create'; agentId: string; taskId?: string }
export interface SessionsMessagesMsg extends ClientMessage { type: 'sessions.messages'; sessionId: string; limit?: number; before?: string }
export interface SessionsEventsMsg extends ClientMessage { type: 'sessions.events'; sessionId: string; limit?: number; afterSequence?: number }
export interface TasksListMsg extends ClientMessage { type: 'tasks.list'; status?: TaskStatus }
export interface TasksCreateMsg extends ClientMessage { type: 'tasks.create'; title: string; description?: string; assignAgentId?: string }
export interface TasksUpdateMsg extends ClientMessage { type: 'tasks.update'; taskId: string; status?: TaskStatus; stage?: string }
export interface RulesListMsg extends ClientMessage { type: 'rules.list' }
export interface RulesCreateMsg extends ClientMessage { type: 'rules.create'; name: string; cron: string; action: string; actionConfig: { title: string; description?: string; assignAgentId?: string }; description?: string; enabled?: boolean }
export interface RulesUpdateMsg extends ClientMessage { type: 'rules.update'; ruleId: string; name?: string; cron?: string; action?: string; actionConfig?: Record<string, unknown>; description?: string; enabled?: boolean }
export interface RulesToggleMsg extends ClientMessage { type: 'rules.toggle'; ruleId: string; enabled: boolean }
export interface RulesDeleteMsg extends ClientMessage { type: 'rules.delete'; ruleId: string }

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
  | { type: 'session:event'; sessionId: string; agentId?: string | null; event: SessionEventData }
  | { type: 'session:done'; sessionId: string; agentId: string; messageId: string; turnUsage?: TurnUsageData }
  | { type: 'session:capabilities'; sessionId: string; capabilities: SessionCapabilities }
  | { type: 'agent:status'; agentId: string; status: AgentStatus }
  | { type: 'task:update'; taskId: string; data: Record<string, unknown> }
  | { type: 'rule:update'; ruleId: string; data: Record<string, unknown> }
  | { type: 'result'; requestId?: string; data: unknown }
  | { type: 'error'; requestId?: string; message: string }
