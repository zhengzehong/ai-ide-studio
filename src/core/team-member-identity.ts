import { agentStore, type AgentRow } from '../store/agents.js'
import { toolBindingStore } from '../store/tools.js'
import { ensureAgentPrimarySession } from './agent-primary-sessions.js'
import { agentMemoryService } from './agent-memory.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('team-member-identity')

export function copyTeamAgent(projectId: string, sourceId: string, name?: string): AgentRow {
  const source = agentStore.get(sourceId)
  if (!source || source.project_id !== projectId) throw new Error('来源 Agent 不属于当前项目')
  const config = source.config_json ? JSON.parse(source.config_json) as Record<string, unknown> : {}
  const definition = Object.fromEntries(['skills', 'modelProfileId', 'modelProfileMode']
    .filter(key => config[key] !== undefined).map(key => [key, config[key]]))
  const agent = agentStore.create({
    projectId, name: name?.trim() || source.name, type: source.type, runtime: source.runtime,
    systemPrompt: source.system_prompt, icon: source.icon, avatarUrl: source.avatar_url,
    permissionLevel: source.permission_level,
    config: { ...definition, teamInternal: true, sourceAgentId: source.id },
  })
  for (const binding of toolBindingStore.list().filter(row => row.scope === 'agent' && row.target_id === source.id)) {
    toolBindingStore.setEnabled(binding.tool_id, 'agent', agent.id, binding.enabled === 1,
      binding.config_override_json ? JSON.parse(binding.config_override_json) as Record<string, unknown> : undefined)
  }
  ensureAgentPrimarySession(agent)
  agentMemoryService.seedBuiltinDimensions(projectId, agent.id)
  log.info({ agentId: agent.id, sourceAgentId: sourceId, projectId }, '已复制团队专属 Agent 定义')
  return agentStore.setHidden(agent.id, true)
}
