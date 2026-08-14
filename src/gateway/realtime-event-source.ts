import { events, type AppEvents } from '../core/events.js'
import {
  SessionUpdateBatcher,
  type SessionUpdateBatcherOptions,
  type SessionUpdateEnvelope,
} from '../core/session-update-batcher.js'
import { createChildLogger } from '../core/logger.js'
import type { RealtimeDelivery } from '../realtime/protocol.js'

const log = createChildLogger('realtime-event-source')

export interface RealtimeEventSource {
  stop(): void
}

export function createRealtimeEventSource(
  sink: (delivery: RealtimeDelivery) => void | Promise<void>,
  batcherOptions: SessionUpdateBatcherOptions = {},
): RealtimeEventSource {
  const batcher = new SessionUpdateBatcher(batcherOptions)
  const send = (delivery: RealtimeDelivery): void => {
    try {
      const result = sink(delivery)
      if (result instanceof Promise) {
        void result.catch((error) => log.warn({ err: error, scope: delivery.scope }, 'Realtime event delivery failed'))
      }
    } catch (error) {
      log.warn({ err: error, scope: delivery.scope }, 'Realtime event delivery failed')
    }
  }
  const sendSessionUpdate = (event: SessionUpdateEnvelope): void => send({
    scope: 'session',
    sessionId: event.sessionId,
    message: {
      type: 'session:update',
      sessionId: event.sessionId,
      agentId: event.agentId,
      data: event.data,
    },
  })
  const unsubscribe: Array<() => void> = []
  const on = <K extends keyof AppEvents>(type: K, handler: (event: AppEvents[K]) => void): void => {
    events.on(type, handler)
    unsubscribe.push(() => events.off(type, handler))
  }

  on('session:update', (event) => {
    if (event.source === 'runtime-persistence') return
    batcher.handle(event, sendSessionUpdate)
  })
  on('session:process_item', (event) => send({
    scope: 'session',
    sessionId: event.sessionId,
    message: { type: 'session:process_item', ...event },
  }))
  on('session:event', (event) => send({
    scope: 'session',
    sessionId: event.sessionId,
    message: { type: 'session:event', ...event },
  }))
  on('session:committed_done', (event) => {
    void batcher.flushSession(event.sessionId, sendSessionUpdate).then(() => send({
      scope: 'session',
      sessionId: event.sessionId,
      message: { type: 'session:done', ...event },
    })).catch((error) => log.error({ err: error, sessionId: event.sessionId }, 'Realtime done flush failed'))
  })
  on('session:activity', (event) => send({ scope: 'all', message: { type: 'session:activity', ...event } }))
  on('session:capabilities', (event) => send({
    scope: 'session',
    sessionId: event.sessionId,
    message: { type: 'session:capabilities', ...event },
  }))
  on('session:changed', (event) => send({ scope: 'all', message: { type: 'session:changed', ...event } }))
  on('session-dock:update', (event) => send({ scope: 'all', message: { type: 'session-dock:update', ...event } }))
  on('session:copy_failed', (event) => send({ scope: 'all', message: { type: 'session:copy_failed', ...event } }))
  on('agent:status', (event) => send({ scope: 'all', message: { type: 'agent:status', ...event } }))
  on('task:update', (event) => send({ scope: 'all', message: { type: 'task:update', ...event } }))
  on('team:update', (event) => send({ scope: 'all', message: { type: 'team:update', ...event } }))
  on('rule:update', (event) => send({ scope: 'all', message: { type: 'rule:update', ...event } }))
  on('timeline:updated', (event) => send({ scope: 'all', message: { type: 'timeline:updated', ...event } }))
  on('event-center:update', (event) => send({ scope: 'all', message: { type: 'event-center:update', data: event } }))
  on('knowledge-base:update', (event) => send({ scope: 'all', message: { type: 'knowledge-base:update', data: event } }))
  on('autonomy:update', (event) => send({ scope: 'all', message: { type: 'autonomy:update', ...event } }))
  on('secretary:update', (event) => send({ scope: 'all', message: { type: 'secretary:update', ...event } }))

  return {
    stop(): void {
      for (const remove of unsubscribe) remove()
      batcher.dispose()
    },
  }
}
