import { sessionStore } from '../store/sessions.js'

const SECRETARY_SESSION_TOOLS = new Set(['secretary.report'])

export function isToolVisibleForSession(toolName: string, sessionId?: string): boolean {
  if (!SECRETARY_SESSION_TOOLS.has(toolName)) return true
  if (!sessionId) return false
  const purpose = sessionStore.get(sessionId)?.purpose
  return purpose === 'secretary_runtime' || purpose === 'secretary_chat'
}
