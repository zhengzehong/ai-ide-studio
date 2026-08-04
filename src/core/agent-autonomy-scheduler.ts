import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'
import { getAgentAutonomyConfig, updateAgentAutonomyConfig } from './agent-autonomy-config.js'
import { events } from './events.js'

const log = createChildLogger('agent-autonomy-scheduler')

export interface AutonomyTickResult {
  sessionId?: string
  skipped?: 'disabled' | 'missing-session' | 'busy' | 'not-due'
}

export async function runAgentAutonomyTick(
  agentId: string,
  sessionId: string,
  options: { force?: boolean } = {},
): Promise<AutonomyTickResult> {
  const agent = agentStore.get(agentId)
  if (!agent?.project_id) throw new Error(`自主 Agent 不存在或不属于项目: ${agentId}`)
  const config = getAgentAutonomyConfig(agentId)
  if (!config.enabled) return skip(agentId, 'disabled')
  const session = sessionStore.get(sessionId)
  if (!session || session.agent_id !== agentId || session.purpose !== 'autonomy' || session.deleted_at) {
    return skip(agentId, 'missing-session')
  }
  if (sessionManager.isPromptPending(sessionId)) return skip(agentId, 'busy')
  if (!options.force && !config.dirty && config.plan.nextCheckAt && Date.parse(config.plan.nextCheckAt) > Date.now()) {
    return skip(agentId, 'not-due')
  }

  const now = new Date()
  updateAgentAutonomyConfig(agentId, {
    dirty: false,
    lastRunAt: now.toISOString(),
    lastSkipReason: null,
    lastError: null,
    plan: { nextCheckAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString() },
  })
  emitUpdate(agentId, agent.project_id)
  const prompt = buildTickPrompt(config.interests.map((item) => item.text), config.plan.items)
  try {
    await sessionManager.enqueuePrompt(sessionId, prompt, undefined, {
      senderRole: 'autonomy',
      senderId: agentId,
      senderName: '自主检查',
    })
    return { sessionId }
  } catch (err) {
    updateAgentAutonomyConfig(agentId, {
      lastError: err instanceof Error ? err.message : String(err),
      dirty: true,
    })
    emitUpdate(agentId, agent.project_id)
    throw err
  }
}

function skip(agentId: string, reason: NonNullable<AutonomyTickResult['skipped']>): AutonomyTickResult {
  updateAgentAutonomyConfig(agentId, { lastSkipReason: reason })
  const projectId = agentStore.get(agentId)?.project_id
  if (projectId) emitUpdate(agentId, projectId)
  log.debug({ agentId, reason }, 'Autonomy tick skipped')
  return { skipped: reason }
}

function emitUpdate(agentId: string, projectId: string): void {
  events.emit('autonomy:update', { agentId, projectId })
}

function buildTickPrompt(
  interests: string[],
  plan: Array<{ id: string; title: string; status: string; note?: string }>,
): string {
  return [
    '这是一次自主检查。请先读取系统提示词指定的工作记忆文件，再根据关注点和当前排班决定是否推进工作。',
    `关注点:\n${interests.length > 0 ? interests.map((item) => `- ${item}`).join('\n') : '- 暂无用户关注点'}`,
    `当前排班:\n${plan.length > 0 ? plan.map((item) => `- [${item.status}] ${item.title}${item.note ? `: ${item.note}` : ''}`).join('\n') : '- 尚未建立排班'}`,
    '完成后按需更新排班和工作记忆；只有产生值得用户关注的新结论时才提交汇报。没有工作时直接结束。',
  ].join('\n\n')
}
