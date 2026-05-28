import * as acp from '@agentclientprotocol/sdk'
import { events } from '../core/events.js'
import type { SessionUpdateData } from '../types/ws-protocol.js'
import type { PendingElicitation, PendingPermission } from './host-types.js'

export const pendingPermissions = new Map<string, PendingPermission>()
export const pendingElicitations = new Map<string, PendingElicitation>()

export function requestKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}

export function hasPendingInteractionsForSession(ourSessionId: string): boolean {
  const prefix = `${ourSessionId}:`
  return [...pendingPermissions.keys()].some(key => key.startsWith(prefix)) ||
    [...pendingElicitations.keys()].some(key => key.startsWith(prefix))
}

export function hasPendingInteractionsForAgent(agentId: string): boolean {
  return [...pendingPermissions.values()].some(pending => pending.agentId === agentId) ||
    [...pendingElicitations.values()].some(pending => pending.agentId === agentId)
}

export function resolvePermission(ourSessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean {
  const key = requestKey(ourSessionId, requestId)
  const pending = pendingPermissions.get(key)
  if (!pending) return false
  clearTimeout(pending.timeout)
  pendingPermissions.delete(key)
  pending.resolve(cancelled || !optionId ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } })
  return true
}

export function resolveElicitation(ourSessionId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>): boolean {
  const key = requestKey(ourSessionId, requestId)
  const pending = pendingElicitations.get(key)
  if (!pending) return false
  clearTimeout(pending.timeout)
  pendingElicitations.delete(key)
  if (action === 'accept') pending.resolve({ action, content: content ?? {} })
  else pending.resolve({ action })
  return true
}

export function cancelPendingInteractions(ourSessionId: string, agentId: string): void {
  for (const [key, pending] of pendingPermissions) {
    if (!key.startsWith(`${ourSessionId}:`)) continue
    clearTimeout(pending.timeout)
    pendingPermissions.delete(key)
    pending.resolve({ outcome: { outcome: 'cancelled' } })
    events.emit('session:update', {
      sessionId: ourSessionId,
      agentId: pending.agentId || agentId,
      data: {
        messageId: pending.requestId,
        role: 'system',
        content: '',
        eventType: 'permission.result',
      } satisfies SessionUpdateData,
    })
  }

  for (const [key, pending] of pendingElicitations) {
    if (!key.startsWith(`${ourSessionId}:`)) continue
    clearTimeout(pending.timeout)
    pendingElicitations.delete(key)
    pending.resolve({ action: 'cancel' })
    events.emit('session:update', {
      sessionId: ourSessionId,
      agentId: pending.agentId || agentId,
      data: {
        messageId: pending.requestId,
        role: 'system',
        content: '',
        eventType: 'elicitation.result',
      } satisfies SessionUpdateData,
    })
  }
}

export function waitForPermission(agentId: string, ourSessionId: string, requestId: string): Promise<acp.RequestPermissionResponse> {
  return new Promise<acp.RequestPermissionResponse>((resolve) => {
    const key = requestKey(ourSessionId, requestId)
    const timeout = setTimeout(() => {
      pendingPermissions.delete(key)
      events.emit('session:update', {
        sessionId: ourSessionId,
        agentId,
        data: { messageId: requestId, role: 'system', content: '', eventType: 'permission.result' } satisfies SessionUpdateData,
      })
      resolve({ outcome: { outcome: 'cancelled' } })
    }, 10 * 60 * 1000)
    pendingPermissions.set(key, { resolve, timeout, agentId, requestId })
  })
}

export function waitForElicitation(agentId: string, ourSessionId: string, requestId: string): Promise<acp.CreateElicitationResponse> {
  return new Promise<acp.CreateElicitationResponse>((resolve) => {
    const key = requestKey(ourSessionId, requestId)
    const timeout = setTimeout(() => {
      pendingElicitations.delete(key)
      events.emit('session:update', {
        sessionId: ourSessionId,
        agentId,
        data: { messageId: requestId, role: 'system', content: '', eventType: 'elicitation.result' } satisfies SessionUpdateData,
      })
      resolve({ action: 'cancel' })
    }, 10 * 60 * 1000)
    pendingElicitations.set(key, { resolve, timeout, agentId, requestId })
  })
}
