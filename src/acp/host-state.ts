import type { ChildProcess } from 'child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { AgentConnection, RuntimeSessionState } from './host-types.js'
import type { ClaudeSessionMeta } from './model-profile-env.js'

export const agentConnections = new Map<string, AgentConnection>()

export function createConnectionState(
  agentId: string,
  runtime: string,
  proc: ChildProcess,
  connection: acp.ClientSideConnection,
  agentCapabilities?: acp.AgentCapabilities,
  envFingerprint?: string,
  sessionMeta?: ClaudeSessionMeta,
): AgentConnection {
  const now = Date.now()
  return {
    agentId,
    proc,
    connection,
    runtime,
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
    }
    conn.runtimeSessions.set(ourSessionId, state)
  }
  return state
}

export function markSessionConnected(conn: AgentConnection, ourSessionId: string, acpSessionId: string): void {
  const now = Date.now()
  conn.acpSessions.set(ourSessionId, acpSessionId)
  const session = getRuntimeSession(conn, ourSessionId)
  session.acpSessionId = acpSessionId
  session.state = 'connected'
  session.lastUsedAt = now
  session.connectPromise = undefined
  conn.lastUsedAt = now
}

export function touchRuntime(conn: AgentConnection, ourSessionId?: string): void {
  const now = Date.now()
  conn.lastUsedAt = now
  if (ourSessionId) getRuntimeSession(conn, ourSessionId).lastUsedAt = now
}

export function beginTurn(conn: AgentConnection, ourSessionId: string): void {
  const session = getRuntimeSession(conn, ourSessionId)
  if (session.activeTurnCount > 0) {
    throw new Error('当前会话正在生成中，请等待本轮完成或先停止生成')
  }
  session.activeTurnCount += 1
  conn.activeTurnCount += 1
  touchRuntime(conn, ourSessionId)
}

export function endTurn(conn: AgentConnection, ourSessionId: string): void {
  const session = getRuntimeSession(conn, ourSessionId)
  session.activeTurnCount = Math.max(0, session.activeTurnCount - 1)
  conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
  touchRuntime(conn, ourSessionId)
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
