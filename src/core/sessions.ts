import { sessionStore, messageStore, eventStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { agentStore } from '../store/agents.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import type { ImageAttachment, SessionUpdateData, ToolCallData } from '../types/ws-protocol.js'
import { mergeToolCall } from './tool-calls.js'

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
    if (idx >= 0) pending.toolCalls[idx] = mergeToolCall(pending.toolCalls[idx], data.toolCallUpdate)
    else pending.toolCalls.push(data.toolCallUpdate)
  }
})

events.on('session:update', (ev) => {
  const payload = eventPayloadFromUpdate(ev.data)
  if (!payload) return
  const stored = eventStore.append(ev.sessionId, {
    type: payload.type,
    agentId: ev.agentId,
    messageId: ev.data.messageId,
    role: ev.data.role,
    payload: payload.payload,
  })
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
})

events.on('session:done', (ev) => {
  const stored = eventStore.append(ev.sessionId, {
    type: 'message.done',
    agentId: ev.agentId,
    messageId: ev.messageId,
    role: 'agent',
    payload: { messageId: ev.messageId, turnUsage: ev.turnUsage },
  })
  events.emit('session:event', { sessionId: ev.sessionId, agentId: ev.agentId, event: stored })
})

function eventPayloadFromUpdate(data: SessionUpdateData): { type: string; payload: unknown } | null {
  if (data.contentDelta || data.content) return { type: data.eventType || 'message.chunk', payload: { messageId: data.messageId, role: data.role, contentDelta: data.contentDelta, content: data.content } }
  if (data.thinking) return { type: 'thinking.chunk', payload: { messageId: data.messageId, thinking: data.thinking } }
  if (data.toolCall) return { type: 'tool.call', payload: { messageId: data.messageId, toolCall: data.toolCall } }
  if (data.toolCallUpdate) return { type: 'tool.update', payload: { messageId: data.messageId, toolCall: data.toolCallUpdate } }
  if (data.usage) return { type: 'usage.update', payload: { usage: data.usage } }
  if (data.plan) return { type: 'plan.update', payload: { plan: data.plan } }
  if (data.configOptions) return { type: 'config.update', payload: { configOptions: data.configOptions } }
  if (data.commands) return { type: 'commands.update', payload: { commands: data.commands } }
  if (data.sessionInfo) return { type: 'session.info', payload: { sessionInfo: data.sessionInfo } }
  if (data.permissionRequest) return { type: 'permission.request', payload: { permissionRequest: data.permissionRequest } }
  if (data.elicitationRequest) return { type: 'elicitation.request', payload: { elicitationRequest: data.elicitationRequest } }
  if (data.attachments) return { type: 'message.attachments', payload: { messageId: data.messageId, attachments: data.attachments } }
  return null
}

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

events.on('session:done', (ev) => {
  const session = sessionStore.get(ev.sessionId)
  if (!session?.task_id) return

  const task = taskStore.get(session.task_id)
  if (!task || task.status !== 'executing') return

  const stage = 'Agent 已完成，等待人工确认'
  taskStore.updateStatus(task.id, 'reviewing', stage)
  events.emit('task:update', {
    taskId: task.id,
    data: { ...taskStore.get(task.id), event: 'agent_completed' },
  })
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

  async sendPrompt(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const session = sessionStore.get(sessionId)
    if (!session) throw new Error(`Session 不存在: ${sessionId}`)

    const humanMessage = messageStore.append(sessionId, { role: 'human', content, attachments: images })
    const stored = eventStore.append(sessionId, {
      type: 'message.user',
      agentId: session.agent_id,
      messageId: humanMessage.id,
      role: 'human',
      payload: { messageId: humanMessage.id, content, attachments: images || [] },
    })
    events.emit('session:event', { sessionId, agentId: session.agent_id, event: stored })

    if (!acpHost.isRunning(session.agent_id)) {
      await acpHost.startAgent(session.agent_id)
    }

    if (!acpHost.hasAcpSession(session.agent_id, sessionId)) {
      if (session.acp_session_id) {
        await acpHost.resumeSession(session.agent_id, sessionId, session.acp_session_id)
      } else {
        const acpSessionId = await acpHost.newSession(session.agent_id, sessionId)
        sessionStore.updateAcpSessionId(sessionId, acpSessionId)
      }
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
