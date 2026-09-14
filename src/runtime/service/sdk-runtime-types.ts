import type { ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type {
  CloneClaudeSessionFilesInput,
  CloneClaudeSessionFilesResult,
  ClaudeSessionFilesInput,
} from '../../acp/claude-session-files.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import type { AgentStatus, SessionActivityReason, SessionCapabilities, TurnUsageData } from '../../types/ws-protocol.js'
import type { RuntimeCoalescibleUpdate } from '../streams/runtime-update-coalescer.js'
import type { AcpAutonomousTurnBridge, AcpRuntimeClientRouter } from './acp-runtime-client.js'
import type { AutonomousTurnTimings } from './autonomous-turn-tracker.js'
import type { ManagedAcpAgent, StartManagedAcpAgentInput } from './managed-acp-agent.js'

export interface SdkAgentRuntime {
  captureBindingId?: string
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
  publishAgentStatus?: (event: { agentId: string; status: AgentStatus; captureBindingId?: string }) => void
  publishCapabilities?: (sessionId: string, capabilities: SessionCapabilities) => void
  /**
   * 会话活动广播(all-scope 语义):自治回合开始/结算时下发 running/idle,
   * dispatcher/wake 的 idle 续跑与所有客户端的侧栏"正在执行"复位都依赖它。
   */
  publishSessionActivity?: (event: {
    sessionId: string
    agentId: string
    state: 'running' | 'idle'
    reason: SessionActivityReason
    turnId?: string
  }) => void
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
  /** 自治回合状态机计时(测试用,可缩短)。 */
  autonomousTurnTimings?: Partial<AutonomousTurnTimings>
}

export type { AcpAutonomousTurnBridge }
