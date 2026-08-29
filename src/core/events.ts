import mittModule from 'mitt'
import type {
  AgentStatus,
  SessionActivityData,
  SessionDoneData,
  SessionUpdateData,
  SessionCapabilities,
  SessionEventData,
  TurnProcessItemData,
} from '../types/ws-protocol.js'
import { SessionUpdateActorScheduler } from './session-update-actors.js'
import type { SessionUpdateSource } from './session-update-source.js'

export type AppEvents = {
  'session:update': {
    sessionId: string
    agentId: string
    data: SessionUpdateData
    source?: SessionUpdateSource
    streamGeneration?: string
    sequence?: number
  }
  'session:process_item': { sessionId: string; agentId?: string | null; item: TurnProcessItemData }
  'session:event': { sessionId: string; agentId?: string | null; event: SessionEventData }
  'session:manual-prompt-started': { sessionId: string; agentId: string }
  'session:activity': SessionActivityData
  'session:done': SessionDoneData
  'session:committed_done': SessionDoneData
  'session:capabilities': { sessionId: string; capabilities: SessionCapabilities }
  'session:changed': { sessionId: string; data: Record<string, unknown> }
  'session-dock:update': { action: 'added' | 'removed' | 'reordered'; sessionId?: string }
  'session:copy_failed': { sourceSessionId: string; targetSessionId: string; message: string }
  'agent:status': { agentId: string; status: AgentStatus }
  'task:update': { taskId: string; data: Record<string, unknown> }
  'team:update': { teamId: string; sessionIds: string[]; data: Record<string, unknown> }
  'task:created': { taskId: string; title: string; assignAgentId?: string }
  'rule:update': { ruleId: string; data: Record<string, unknown> }
  'timeline:updated': { sessionId: string }
  'event-center:update': Record<string, unknown>
  'knowledge-base:update': Record<string, unknown>
  'autonomy:update': { agentId: string; projectId: string }
  'secretary:update': { projectId: string }
  'inspiration:update': { projectId: string; noteId?: string }
}

const mitt = mittModule as unknown as typeof import('mitt').default

const bus = mitt<AppEvents>()
const sessionUpdateScheduler = new SessionUpdateActorScheduler({
  handleUpdate: (ev) => bus.emit('session:update', ev),
})

export const events: typeof bus = {
  all: bus.all,
  on: bus.on.bind(bus),
  off: bus.off.bind(bus),
  emit: ((type: keyof AppEvents, event: AppEvents[keyof AppEvents]) => {
    if (type === 'session:update') {
      sessionUpdateScheduler.enqueue(event as AppEvents['session:update'])
      return
    }

    if (type === 'session:done') {
      flushSessionUpdates((event as AppEvents['session:done']).sessionId)
    }

    bus.emit(type, event)
  }) as typeof bus.emit,
}

export function flushSessionUpdates(sessionId: string): void {
  sessionUpdateScheduler.flushSession(sessionId)
}
