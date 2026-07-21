import type { SessionRow } from '../store/sessions.js'
import { events } from './events.js'

export function publishSessionCreated(session: SessionRow): SessionRow {
  events.emit('session:changed', { sessionId: session.id, data: { ...session } })
  return session
}
