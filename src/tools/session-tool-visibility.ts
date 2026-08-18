import { sessionStore } from '../store/sessions.js'

const SECRETARY_SESSION_TOOLS = new Set(['secretary.report'])
const SECRETARY_MANAGEMENT_TOOLS = new Set([
  'studio.secretary.list',
  'studio.secretary.get',
  'studio.secretary.create',
  'studio.secretary.update',
  'studio.secretary.delete',
])

export function isToolVisibleForSession(toolName: string, sessionId?: string): boolean {
  if (!SECRETARY_SESSION_TOOLS.has(toolName) && !SECRETARY_MANAGEMENT_TOOLS.has(toolName)) return true
  if (!sessionId) return false
  const purpose = sessionStore.get(sessionId)?.purpose
  if (SECRETARY_MANAGEMENT_TOOLS.has(toolName)) return purpose === 'conversation'
  return purpose === 'secretary_runtime' || purpose === 'secretary_chat'
}
