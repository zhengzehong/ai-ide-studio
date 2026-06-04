import type { SessionUpdateData } from '../types/ws-protocol.js'

export function eventPayloadFromUpdate(data: SessionUpdateData): { type: string; payload: unknown } | null {
  if (data.eventType === 'permission.result')
    return { type: 'permission.result', payload: { requestId: data.messageId, cancelled: true } }
  if (data.eventType === 'elicitation.result')
    return { type: 'elicitation.result', payload: { requestId: data.messageId, action: 'cancel' } }
  if (data.contentDelta || data.content)
    return {
      type: data.eventType || 'message.chunk',
      payload: { messageId: data.messageId, role: data.role, contentDelta: data.contentDelta, content: data.content },
    }
  if (data.thinking) return { type: 'thinking.chunk', payload: { messageId: data.messageId, thinking: data.thinking } }
  if (data.toolCall) return { type: 'tool.call', payload: { messageId: data.messageId, toolCall: data.toolCall } }
  if (data.toolCallUpdate)
    return { type: 'tool.update', payload: { messageId: data.messageId, toolCall: data.toolCallUpdate } }
  if (data.usage) return { type: 'usage.update', payload: { usage: data.usage } }
  if (data.plan) return { type: 'plan.update', payload: { plan: data.plan } }
  if (data.configOptions) return { type: 'config.update', payload: { configOptions: data.configOptions } }
  if (data.commands) return { type: 'commands.update', payload: { commands: data.commands } }
  if (data.sessionInfo) return { type: 'session.info', payload: { sessionInfo: data.sessionInfo } }
  if (data.permissionRequest)
    return { type: 'permission.request', payload: { permissionRequest: data.permissionRequest } }
  if (data.elicitationRequest)
    return { type: 'elicitation.request', payload: { elicitationRequest: data.elicitationRequest } }
  if (data.attachments)
    return { type: 'message.attachments', payload: { messageId: data.messageId, attachments: data.attachments } }
  return null
}
