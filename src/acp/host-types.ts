import type { ChildProcess } from 'child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { AgentRow } from '../store/agents.js'
import type { SessionCapabilities } from '../types/ws-protocol.js'
import type { AgentSessionMeta } from './model-profile-env.js'

export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped'
export type AcpSessionState = 'connecting' | 'connected' | 'closing' | 'disconnected'

export interface RuntimeSessionState {
  ourSessionId: string
  acpSessionId?: string
  state: AcpSessionState
  contextKey?: string
  lastUsedAt: number
  activeTurnCount: number
  activeTurnKey?: number
  nextTurnKey: number
  connectPromise?: Promise<string>
  activeTurnReject?: (err: Error) => void
}

export interface AgentConnection {
  agentId: string
  proc: ChildProcess
  connection: acp.ClientSideConnection
  runtime: string
  runtimeEnv: NodeJS.ProcessEnv
  agent: AgentRow
  acpSessions: Map<string, string>
  runtimeSessions: Map<string, RuntimeSessionState>
  sessionCapabilities: Map<string, SessionCapabilities>
  state: RuntimeState
  lastUsedAt: number
  activeTurnCount: number
  agentCapabilities?: acp.AgentCapabilities
  envFingerprint?: string
  sessionMeta?: AgentSessionMeta
}

export interface AcpSessionContext {
  projectId?: string
  cwd?: string
  emitLifecycle?: boolean
}

export interface PendingPermission {
  resolve: (value: acp.RequestPermissionResponse) => void
  timeout: ReturnType<typeof setTimeout>
  agentId: string
  requestId: string
}

export interface PendingElicitation {
  resolve: (value: acp.CreateElicitationResponse) => void
  timeout: ReturnType<typeof setTimeout>
  agentId: string
  requestId: string
}

export interface TerminalProcess {
  sessionId: string
  ourSessionId: string
  proc: ChildProcess
  output: string
  truncated: boolean
  exitCode?: number | null
  signal?: string | null
}

export type InitialSessionState = {
  models?: acp.SessionModelState | null
  modes?: acp.SessionModeState | null
  configOptions?: acp.SessionConfigOption[] | null
}
