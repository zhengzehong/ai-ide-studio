import { agentSessionWatchStore, type AgentSessionWatchRow } from '../store/agent-session-communication.js'
import { sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { assertSessionAccess, contextMember } from './team-access.js'
import { assertTaskAccess } from './team-task-access.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('agent-watch-access')

export function canDeliverAgentWatch(watch: AgentSessionWatchRow): boolean {
  const context = { agentId: watch.watcher_agent_id, sessionId: watch.watcher_session_id, projectId: watch.project_id ?? undefined }
  try {
    const session = sessionStore.get(context.sessionId)
    if (!session || session.status !== 'active') throw new Error('监听会话已关闭')
    contextMember(context)
    if (watch.watched_session_id) assertSessionAccess(context, watch.watched_session_id)
    if (watch.task_id) {
      const task = taskStore.get(watch.task_id)
      if (!task) throw new Error('监听任务不存在')
      assertTaskAccess(context, task)
    }
    return true
  } catch (err) {
    agentSessionWatchStore.markFailed(watch.id, '监听对象已不可访问')
    log.warn({ err, watchId: watch.id, sessionId: context.sessionId }, '停止不可访问的历史监听')
    return false
  }
}
