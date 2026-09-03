import { sessionStore } from '../store/sessions.js'
import { projectInspirationStore } from '../store/project-inspirations.js'
import { projectAdvisorStore } from '../store/advisors.js'

const SECRETARY_SESSION_TOOLS = new Set(['secretary.report'])
const SECRETARY_MANAGEMENT_TOOLS = new Set([
  'studio.secretary.list',
  'studio.secretary.get',
  'studio.secretary.create',
  'studio.secretary.update',
  'studio.secretary.delete',
])
const INSPIRATION_SESSION_TOOLS = new Set(['inspiration.analysis.publish', 'inspiration.note.get'])
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
// 参谋会话专属工具与被屏蔽工具（设计手册 A-1/A-2；agent.session.* 不屏蔽，是参谋翻历史的手脚 A-3）
const ADVISOR_SESSION_TOOLS = new Set(['suggestion.present'])
const ADVISOR_BLOCKED_TOOLS = INSPIRATION_BLOCKED_TOOLS

export function isToolVisibleForSession(toolName: string, sessionId?: string): boolean {
  if (ADVISOR_SESSION_TOOLS.has(toolName)) {
    return !!sessionId && !!projectAdvisorStore.findBySession(sessionId)
  }
  if (sessionId && projectAdvisorStore.findBySession(sessionId) && ADVISOR_BLOCKED_TOOLS.has(toolName)) {
    return false
  }
  if (INSPIRATION_SESSION_TOOLS.has(toolName)) {
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
