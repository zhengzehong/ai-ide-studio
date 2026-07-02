import type { ChildProcess } from 'child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { AcpSessionContext, AgentConnection, RuntimeSessionState } from './host-types.js'
import type { AgentSessionMeta } from './model-profile-env.js'

export const agentConnections = new Map<string, AgentConnection>()

export function createConnectionState(
  agentId: string,
  runtime: string,
  proc: ChildProcess,
  connection: acp.ClientSideConnection,
  agentCapabilities?: acp.AgentCapabilities,
  envFingerprint?: string,
  sessionMeta?: AgentSessionMeta,
  runtimeEnv?: NodeJS.ProcessEnv,
  agent?: import('../store/agents.js').AgentRow,
): AgentConnection {
  const now = Date.now()
  return {
    agentId,
    proc,
    connection,
    runtime,
    runtimeEnv: runtimeEnv ?? process.env,
    agent: agent ?? ({} as import('../store/agents.js').AgentRow),
    acpSessions: new Map(),
    runtimeSessions: new Map(),
    sessionCapabilities: new Map(),
    state: 'running',
    lastUsedAt: now,
    activeTurnCount: 0,
    agentCapabilities,
    envFingerprint,
    sessionMeta,
  }
}

export function getRuntimeSession(conn: AgentConnection, ourSessionId: string): RuntimeSessionState {
  let state = conn.runtimeSessions.get(ourSessionId)
  if (!state) {
    state = {
      ourSessionId,
      acpSessionId: conn.acpSessions.get(ourSessionId),
      state: conn.acpSessions.has(ourSessionId) ? 'connected' : 'disconnected',
      lastUsedAt: Date.now(),
      activeTurnCount: 0,
      nextTurnKey: 0,
    }
    conn.runtimeSessions.set(ourSessionId, state)
  }
  return state
}

export function acpSessionContextKey(context: AcpSessionContext = {}): string {
  return JSON.stringify({
    projectId: context.projectId ?? null,
    cwd: context.cwd ?? null,
  })
}

export function markSessionConnected(conn: AgentConnection, ourSessionId: string, acpSessionId: string, context?: AcpSessionContext): void {
  const now = Date.now()
  conn.acpSessions.set(ourSessionId, acpSessionId)
  const session = getRuntimeSession(conn, ourSessionId)
  session.acpSessionId = acpSessionId
  session.state = 'connected'
  if (context) session.contextKey = acpSessionContextKey(context)
  session.lastUsedAt = now
  session.connectPromise = undefined
  conn.lastUsedAt = now
}

export function touchRuntime(conn: AgentConnection, ourSessionId?: string): void {
  const now = Date.now()
  conn.lastUsedAt = now
  if (ourSessionId) getRuntimeSession(conn, ourSessionId).lastUsedAt = now
}

export function beginTurn(conn: AgentConnection, ourSessionId: string): number {
  const session = getRuntimeSession(conn, ourSessionId)
  if (session.activeTurnCount > 0) {
    throw new Error('当前会话正在生成中，请等待本轮完成或先停止生成')
  }
  session.nextTurnKey = (session.nextTurnKey ?? 0) + 1
  session.activeTurnKey = session.nextTurnKey
  session.activeTurnCount += 1
  conn.activeTurnCount += 1
  touchRuntime(conn, ourSessionId)
  return session.activeTurnKey
}

export function endTurn(conn: AgentConnection, ourSessionId: string): void {
  const session = getRuntimeSession(conn, ourSessionId)
  session.activeTurnCount = Math.max(0, session.activeTurnCount - 1)
  if (session.activeTurnCount === 0) {
    session.activeTurnKey = undefined
    session.activeTurnReject = undefined
  }
  conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
  touchRuntime(conn, ourSessionId)
}

export function setActiveTurnReject(conn: AgentConnection, ourSessionId: string, reject: ((err: Error) => void) | undefined): void {
  const session = getRuntimeSession(conn, ourSessionId)
  session.activeTurnReject = reject
}

export function findLatestOurSessionId(agentId: string): string | undefined {
  const conn = agentConnections.get(agentId)
  if (!conn) return undefined
  return Array.from(conn.acpSessions.keys()).at(-1)
}

export function findOurSessionId(agentId: string, acpSessionId: string): string | undefined {
  const conn = agentConnections.get(agentId)
  if (!conn) return undefined
  for (const [ourId, acpId] of conn.acpSessions) {
    if (acpId === acpSessionId) return ourId
  }
  return undefined
}
