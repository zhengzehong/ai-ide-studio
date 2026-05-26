import { sessionStore, messageStore } from '../store/sessions.js'
import { agentStore } from '../store/agents.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import type { SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'

interface PendingMessage { content: string; thinking: string; toolCalls: ToolCallData[] }
const pendingBySession = new Map<string, PendingMessage>()

events.on('session:update', (ev) => {
  const { sessionId, data } = ev
  let pending = pendingBySession.get(sessionId)
  if (!pending) { pending = { content: '', thinking: '', toolCalls: [] }; pendingBySession.set(sessionId, pending) }

  if (data.contentDelta) pending.content += data.contentDelta
  if (data.thinking) pending.thinking += data.thinking
  if (data.toolCall) pending.toolCalls.push(data.toolCall)
  if (data.toolCallUpdate) {
    const idx = pending.toolCalls.findIndex(t => t.id === data.toolCallUpdate!.id)
    if (idx >= 0) Object.assign(pending.toolCalls[idx], data.toolCallUpdate)
    else pending.toolCalls.push(data.toolCallUpdate)
  }
})

events.on('session:done', (ev) => {
  const pending = pendingBySession.get(ev.sessionId)
  if (pending && (pending.content || pending.thinking || pending.toolCalls.length > 0)) {
    messageStore.append(ev.sessionId, {
      role: 'agent',
      content: pending.content,
      thinking: pending.thinking || undefined,
      toolCalls: pending.toolCalls.length > 0 ? pending.toolCalls : undefined,
    })
  }
  pendingBySession.delete(ev.sessionId)
})

export const sessionManager = {
  async createSession(agentId: string, taskId?: string): Promise<{ id: string; agentId: string; acpSessionId: string }> {
    const agent = agentStore.get(agentId)
    if (!agent) throw new Error(`Agent 不存在: ${agentId}`)

    if (!acpHost.isRunning(agentId)) {
      await acpHost.startAgent(agentId)
    }

    const session = sessionStore.create({ agentId, taskId })
    const acpSessionId = await acpHost.newSession(agentId, session.id)
    sessionStore.updateAcpSessionId(session.id, acpSessionId)

    return { id: session.id, agentId, acpSessionId }
  },

  async sendPrompt(sessionId: string, content: string, images?: { data: string; mimeType: string }[]): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)

    messageStore.append(sessionId, { role: 'human', content })

    if (!acpHost.isRunning(session.agent_id)) {
      await acpHost.startAgent(session.agent_id)
    }

    if (!acpHost.hasAcpSession(session.agent_id, sessionId)) {
      const acpSessionId = await acpHost.newSession(session.agent_id, sessionId)
      sessionStore.updateAcpSessionId(sessionId, acpSessionId)
    }

    await acpHost.prompt(session.agent_id, sessionId, content, images)
  },

  async sendDecision(sessionId: string, _messageId: string, _choice: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)
    // TODO: implement ACP decision forwarding
  },

  async closeSession(sessionId: string): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) return

    await acpHost.closeSession(session.agent_id, sessionId)
    sessionStore.updateStatus(sessionId, 'closed')
  },
}
