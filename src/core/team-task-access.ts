import type { TaskRow } from '../store/tasks.js'
import { taskStepStore } from '../store/task-steps.js'
import { assertAgentAccess, assertSessionAccess, assertTeamMemberAccess, type AgentAccessContext } from './team-access.js'

export function assertTaskAccess(context: AgentAccessContext, task: TaskRow): void {
  if (context.projectId && task.project_id && context.projectId !== task.project_id) throw new Error('任务不属于当前项目')
  context = { ...context, projectId: undefined }
  if (task.team_id) assertTeamMemberAccess(context, task.team_id)
  if (task.assigned_agent_id) assertAgentAccess(context, task.assigned_agent_id)
  if (task.initiator_agent_id) assertAgentAccess(context, task.initiator_agent_id)
  if (task.initiator_session_id) assertSessionAccess(context, task.initiator_session_id)
  for (const step of taskStepStore.listByTask(task.id)) {
    if (step.assignee_agent_id) assertAgentAccess(context, step.assignee_agent_id)
    if (step.session_id) assertSessionAccess(context, step.session_id)
  }
}
