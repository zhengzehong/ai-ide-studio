import { agentStore, type AgentRow } from '../store/agents.js'
import { templateStore } from '../store/agent-templates.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { teamMemberStore } from '../store/teams.js'
import { deployTemplateToProject, updateProjectAgent } from './agents.js'

export function createFixedMaster(projectId: string, masterPrompt?: string): { agent: AgentRow; session: SessionRow; prompt: string } {
  const template = templateStore.get('tpl-team-leader')
  if (!template) throw new Error('Team Master 模板不存在')
  const prompt = masterPrompt?.trim() || template.system_prompt
  const deployed = deployTemplateToProject('tpl-team-leader', projectId, { systemPrompt: prompt })
  const agent = markTeamInternalAgent(deployed)
  const session = sessionStore.findPrimaryByAgent(agent.id)
  if (!session) throw new Error('Team Master 主会话创建失败')
  return { agent, session, prompt }
}

export function markTeamInternalAgent(agent: AgentRow): AgentRow {
  const config = parseConfig(agent.config_json)
  const updated = agentStore.update(agent.id, { config: { ...config, teamInternal: true } })
  if (!updated) throw new Error(`Agent 不存在: ${agent.id}`)
  return agentStore.setHidden(updated.id, true)
}

export function updateMasterPrompt(teamId: string, prompt: string): string {
  const leader = teamMemberStore.list(teamId).find((member) => member.role === 'leader')
  if (!leader) throw new Error('Team 没有 Master 成员')
  const normalized = prompt.trim()
  if (!normalized) throw new Error('Master 提示词不能为空')
  updateProjectAgent(leader.agent_id, { systemPrompt: normalized })
  return normalized
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
