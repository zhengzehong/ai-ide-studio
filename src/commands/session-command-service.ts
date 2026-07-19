import { events } from '../core/events.js'
import { createChildLogger } from '../core/logger.js'
import { sessionManager } from '../core/sessions.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { shouldForceRuntimeCancel } from '../runtime/api/runtime-cancel-watchdog.js'
import { eventStore, sessionStore } from '../store/sessions.js'
import type { SessionCommand } from './session-command-types.js'

const log = createChildLogger('session-command-service')

export type SessionCommandExecutionResult =
  | { ok: true }
  | { status: 'completed' }
  | { sessionId: string; lastReadAt: string }

export async function executeSessionCommand(
  command: SessionCommand,
): Promise<SessionCommandExecutionResult> {
  switch (command.type) {
    case 'prompt':
      await sessionManager.sendPrompt(command.sessionId, command.content, command.images, {
        clientMessageId: command.clientMessageId,
        contextProjectId: command.contextProjectId,
      })
      return { status: 'completed' }
    case 'session.cancel':
      await cancelSessionPrompt(command.sessionId)
      return { ok: true }
    case 'sessions.markRead':
      return markSessionRead(command.sessionId)
    case 'permission.respond':
      await resolvePermission(command)
      return { ok: true }
    case 'elicitation.respond':
      await resolveElicitation(command)
      return { ok: true }
  }
}

async function cancelSessionPrompt(sessionId: string): Promise<void> {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const completed = await Promise.race([
    getRuntimePort().cancelPrompt(session.agent_id, sessionId).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ])
  if (!shouldForceRuntimeCancel(completed, sessionManager.isPromptActive(sessionId))) return
  sessionManager.forceClearActivePrompt(sessionId)
  log.warn({ sessionId, agentId: session.agent_id }, 'Runtime cancel timed out; forcing done')
  events.emit('session:done', {
    sessionId,
    agentId: session.agent_id,
    messageId: `cancel-timeout-${Date.now()}`,
    stopReason: 'cancelled',
  })
}

function markSessionRead(sessionId: string): { sessionId: string; lastReadAt: string } {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error('会话不存在')
  const lastReadAt = sessionStore.markRead(sessionId)
  events.emit('session:changed', { sessionId, data: { lastReadAt } })
  log.info({ sessionId, lastReadAt }, 'session marked as read')
  return { sessionId, lastReadAt }
}

async function resolvePermission(
  command: Extract<SessionCommand, { type: 'permission.respond' }>,
): Promise<void> {
  const ok = await getRuntimePort().resolvePermission(
    command.sessionId,
    command.permissionRequestId,
    command.optionId,
    command.cancelled,
  )
  if (!ok) throw new Error('权限请求已失效')
  const session = sessionStore.get(command.sessionId)
  const stored = eventStore.append(command.sessionId, {
    type: 'permission.result',
    agentId: session?.agent_id,
    messageId: command.permissionRequestId,
    role: 'system',
    payload: {
      requestId: command.permissionRequestId,
      optionId: command.optionId,
      cancelled: command.cancelled === true,
    },
  })
  events.emit('session:event', { sessionId: command.sessionId, agentId: session?.agent_id, event: stored })
}

async function resolveElicitation(
  command: Extract<SessionCommand, { type: 'elicitation.respond' }>,
): Promise<void> {
  const ok = await getRuntimePort().resolveElicitation(
    command.sessionId,
    command.elicitationRequestId,
    command.action,
    command.content,
  )
  if (!ok) throw new Error('提问请求已失效')
  const session = sessionStore.get(command.sessionId)
  const stored = eventStore.append(command.sessionId, {
    type: 'elicitation.result',
    agentId: session?.agent_id,
    messageId: command.elicitationRequestId,
    role: 'system',
    payload: {
      requestId: command.elicitationRequestId,
      action: command.action,
      content: command.content,
    },
  })
  events.emit('session:event', { sessionId: command.sessionId, agentId: session?.agent_id, event: stored })
}
