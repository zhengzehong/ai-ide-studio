import type { ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type {
  CloneClaudeSessionFilesInput,
  CloneClaudeSessionFilesResult,
  ClaudeSessionFilesInput,
} from '../../acp/claude-session-files.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { AgentStatus, SessionCapabilities, TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import type { AcpRuntimeClientRouter } from './acp-runtime-client.js'
import type { ManagedAcpAgent, StartManagedAcpAgentInput } from './managed-acp-agent.js'

export interface SdkAgentRuntime {
  fingerprint: string
  process: ChildProcess
  connection: acp.ClientSideConnection
  router: AcpRuntimeClientRouter
  agentCapabilities?: acp.AgentCapabilities
  exitPromise: Promise<never>
  rejectExit: (error: Error) => void
  stopping: boolean
  lastUsedAt: number
}

export interface SdkSessionRuntime {
  snapshot: RuntimeStateSnapshot
  acpSessionId: string
  capabilities: SessionCapabilities
  active: boolean
  contextFingerprint: string
  lastUsedAt: number
}

export interface SdkRuntimeHostOptions {
  publishUpdate: (agentId: string, update: RuntimeCoalescibleUpdate) => void
  publishDone: (input: {
    sessionId: string
    agentId: string
    messageId: string
    turnId?: string
    stopReason: string
    turnUsage?: TurnUsageData
  }) => Promise<void>
  publishAgentStatus?: (event: { agentId: string; status: AgentStatus }) => void
  publishCapabilities?: (sessionId: string, capabilities: SessionCapabilities) => void
}

export interface SdkRuntimeHostDependencies {
  startAgent?: (input: StartManagedAcpAgentInput) => Promise<ManagedAcpAgent>
  cloneClaudeSessionFiles?: (
    input: CloneClaudeSessionFilesInput,
  ) => Promise<CloneClaudeSessionFilesResult>
  hasClaudeSessionFiles?: (input: ClaudeSessionFilesInput) => Promise<boolean>
  cancelGraceMs?: number
  closeGraceMs?: number
  restartGraceMs?: number
}
