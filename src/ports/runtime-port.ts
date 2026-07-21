import type { McpServer } from '@agentclientprotocol/sdk'
import type { ImageAttachment, SessionCapabilities } from '../types/ws-protocol.js'

export interface RuntimeAgentSnapshot {
  id: string
  name: string
  type: string
  runtime: string
  permissionLevel: number
  config: Record<string, unknown>
  systemPrompt: string
  projectId: string | null
}

export interface RuntimeSessionSnapshot {
  id: string
  agentId: string
  taskId: string | null
  projectId: string | null
  cwd: string
  title: string | null
  acpSessionId: string | null
  isPrimary: boolean
}

export interface RuntimePreferencesSnapshot {
  modelId?: string
  modeId?: string
  config?: Record<string, string | boolean>
}

export interface RuntimeCommandSnapshot {
  cmd: string
  args: string[]
}

export interface RuntimeProcessSnapshot {
  command?: RuntimeCommandSnapshot
  env: Record<string, string>
  sessionMeta?: Record<string, unknown>
  appliedModelProfile?: {
    id: string
    name: string
    runtime: string
    providerId: string
  }
}

export interface RuntimeTeamSnapshot {
  teamId: string
  memberId: string
  role: string
}

export interface RuntimeStateSnapshot {
  agent: RuntimeAgentSnapshot
  session: RuntimeSessionSnapshot
  runtime: RuntimeProcessSnapshot
  runtimePreferences: RuntimePreferencesSnapshot
  mcpServers: McpServer[]
  team?: RuntimeTeamSnapshot
  autoApprovedToolNames: string[]
}

export interface RuntimePlatformToolTransport {
  type: 'http'
  baseUrl: string
}

export interface RuntimePromptInput {
  agentId: string
  sessionId: string
  content: string
  images?: ImageAttachment[]
  diagnostics?: {
    turnId?: string
    messageId?: string
  }
}

export type RuntimeElicitationContent = Record<string, string | number | boolean | string[]>

export interface RuntimePort {
  readonly platformToolTransport?: RuntimePlatformToolTransport
  ensureSession(snapshot: RuntimeStateSnapshot, options?: { emitLifecycle?: boolean }): Promise<string>
  prompt(input: RuntimePromptInput): Promise<void>
  cancelPrompt(agentId: string, sessionId: string): Promise<void>
  closeSession(agentId: string, sessionId: string): Promise<void>
  forkSession(snapshot: RuntimeStateSnapshot, sourceAcpSessionId: string): Promise<string>
  setModel(agentId: string, sessionId: string, modelId: string): Promise<void>
  setMode(agentId: string, sessionId: string, modeId: string): Promise<void>
  setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void>
  getSessionCapabilities(agentId: string, sessionId: string): Promise<SessionCapabilities | undefined>
  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): Promise<boolean>
  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: RuntimeElicitationContent,
  ): Promise<boolean>
  drain(): Promise<void>
  close(): Promise<void>
}
