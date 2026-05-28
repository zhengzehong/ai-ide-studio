import type { ChildProcess } from 'child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { SessionCapabilities } from '../types/ws-protocol.js'

export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped'
export type AcpSessionState = 'connecting' | 'connected' | 'closing' | 'disconnected'

export interface RuntimeSessionState {
  ourSessionId: string
  acpSessionId?: string
  state: AcpSessionState
  lastUsedAt: number
  activeTurnCount: number
  connectPromise?: Promise<string>
}

export interface AgentConnection {
  agentId: string
  proc: ChildProcess
  connection: acp.ClientSideConnection
  runtime: string
  acpSessions: Map<string, string>
  runtimeSessions: Map<string, RuntimeSessionState>
  sessionCapabilities: Map<string, SessionCapabilities>
  state: RuntimeState
  lastUsedAt: number
  activeTurnCount: number
  agentCapabilities?: acp.AgentCapabilities
}

export interface AcpSessionContext {
  projectId?: string
  cwd?: string
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
