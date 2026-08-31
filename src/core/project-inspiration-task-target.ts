import { agentStore } from '../store/agents.js'
import { projectInspirationStore } from '../store/project-inspirations.js'
import { sessionStore } from '../store/sessions.js'
import type { TaskRow } from '../store/tasks.js'
import { taskStepManager } from './task-steps.js'
import { resolveTaskSession, taskManager, type AgentSessionMode } from './tasks.js'

export interface InspirationTaskTargetInput {
  agentId?: string
  sessionId?: string
  sessionMode?: 'existing' | 'new_each'
}

export function validateInspirationTaskTarget(
  projectId: string,
  agentId?: string | null,
  sessionId?: string | null,
): void {
  if (agentId !== undefined && agentId !== null) requireInspirationProjectAgent(projectId, agentId)
  if (sessionId === undefined || sessionId === null) return
  if (!agentId) throw new Error('默认任务会话必须绑定默认任务 Agent')
  const session = sessionStore.get(sessionId)
  if (!session || session.project_id !== projectId || session.deleted_at || session.archived_at || session.status !== 'active') {
    throw new Error('默认任务会话不存在或不可用')
  }
  if (session.agent_id !== agentId) throw new Error('默认任务会话不属于默认任务 Agent')
}

export function resolveInspirationTaskTarget(
  projectId: string,
  candidate: { suggested_agent_id: string | null },
  input: InspirationTaskTargetInput,
): { agentId: string; sessionId?: string; sessionMode?: AgentSessionMode } {
  if (input.sessionMode === 'existing' && !input.sessionId) {
    throw new Error('选择已有会话时必须选择执行会话')
  }
  const config = projectInspirationStore.ensure(projectId)
  const recommendedAgentId = candidate.suggested_agent_id
  const agentId = input.agentId
    ?? (config.task_target_priority === 'default'
      ? config.task_default_agent_id ?? recommendedAgentId
      : recommendedAgentId ?? config.task_default_agent_id)
    ?? agentStore.list(projectId)[0]?.id
  if (!agentId) throw new Error('当前项目没有可用的执行 Agent')
  requireInspirationProjectAgent(projectId, agentId)
  const sessionId = input.sessionMode === 'new_each'
    ? undefined
    : input.sessionId ?? (agentId === config.task_default_agent_id ? config.task_default_session_id ?? undefined : undefined)
  validateInspirationTaskTarget(projectId, agentId, sessionId)
  return {
    agentId,
    ...(sessionId ? { sessionId } : {}),
    ...(input.sessionMode ? { sessionMode: input.sessionMode } : {}),
  }
}

export async function createInspirationDraftTask(
  title: string,
  description: string,
  projectId: string,
  agentId: string,
  sessionId?: string,
  sessionMode?: AgentSessionMode,
): Promise<TaskRow> {
  const task = await taskManager.createTask({ title, description, projectId, source: 'inspiration' })
  const resolvedSession = sessionMode
    ? await resolveTaskSession({ agentId, projectId, taskId: task.id, sessionId, sessionMode })
    : null
  taskStepManager.addStep({
    taskId: task.id,
    title,
    description,
    assignee: agentId,
    sessionId: resolvedSession?.id ?? sessionId,
  })
  return task
}

export function requireInspirationProjectAgent(projectId: string, agentId: string): void {
  const agent = agentStore.get(agentId)
  if (!agent || agent.project_id !== projectId) throw new Error('执行 Agent 不属于当前项目')
}
