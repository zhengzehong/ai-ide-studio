import { sessionStore } from '../store/sessions.js'
import { projectInspirationStore } from '../store/project-inspirations.js'

const SECRETARY_SESSION_TOOLS = new Set(['secretary.report'])
const SECRETARY_MANAGEMENT_TOOLS = new Set([
  'studio.secretary.list',
  'studio.secretary.get',
  'studio.secretary.create',
  'studio.secretary.update',
  'studio.secretary.delete',
])
const INSPIRATION_SESSION_TOOL = 'inspiration.analysis.publish'
const INSPIRATION_BLOCKED_TOOLS = new Set([
  'create_task',
  'create_schedule',
  'studio.task.create',
  'studio.task.createSimple',
  'studio.task.assign',
  'studio.task.start',
  'studio.task.step.add',
  'studio.task.step.update',
  'studio.task.step.remove',
  'studio.schedule.create',
  'studio.schedule.update',
  'studio.schedule.delete',
  'studio.schedule.toggle',
])

export function isToolVisibleForSession(toolName: string, sessionId?: string): boolean {
  if (toolName === INSPIRATION_SESSION_TOOL) {
    return !!sessionId && !!projectInspirationStore.findBySession(sessionId)
  }
  if (sessionId && projectInspirationStore.findBySession(sessionId) && INSPIRATION_BLOCKED_TOOLS.has(toolName)) {
    return false
  }
  if (!SECRETARY_SESSION_TOOLS.has(toolName) && !SECRETARY_MANAGEMENT_TOOLS.has(toolName)) return true
  if (!sessionId) return false
  const purpose = sessionStore.get(sessionId)?.purpose
  if (SECRETARY_MANAGEMENT_TOOLS.has(toolName)) return purpose === 'conversation'
  return purpose === 'secretary_runtime' || purpose === 'secretary_chat'
}
