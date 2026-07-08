import { isSupportedAgentRuntime, SUPPORTED_AGENT_RUNTIMES } from '../../acp/adapters.js'
import { createCustomProjectAgent, deleteProjectAgent, deployTemplateToProject, updateProjectAgent } from '../../core/agents.js'
import { agentStore } from '../../store/agents.js'
import type { RpcHandlerMap } from './types.js'

export const agentRpcHandlers: RpcHandlerMap = {
  'agents.list'(msg, { sendResult }) {
    sendResult(agentStore.list(msg.projectId as string | undefined))
  },

  'agents.create'(msg, { sendResult }) {
    const runtime = msg.runtime as string
    if (!isSupportedAgentRuntime(runtime)) {
      throw new Error(`不支持的 Agent runtime: ${runtime || '空'}。当前仅支持 ${SUPPORTED_AGENT_RUNTIMES.join('|')}，gemini 尚未接入。`)
    }
    sendResult(agentStore.create({ type: msg.agentType as string, name: msg.name as string, runtime }))
  },

  'agents.deployTemplate'(msg, { sendResult }) {
    const agent = deployTemplateToProject(msg.templateId as string, msg.projectId as string, {
      name: msg.name as string | undefined,
      runtime: msg.runtime as string | undefined,
      systemPrompt: msg.systemPrompt as string | undefined,
      icon: msg.icon as string | undefined,
      avatarUrl: msg.avatarUrl as string | null | undefined,
      modelProfileId: msg.modelProfileId as string | undefined,
    })
    sendResult(agent)
  },

  'agents.createCustom'(msg, { sendResult }) {
    const agent = createCustomProjectAgent({
      projectId: msg.projectId as string,
      name: msg.name as string,
      type: msg.agentType as string,
      runtime: msg.runtime as string,
      systemPrompt: msg.systemPrompt as string | undefined,
      icon: msg.icon as string | undefined,
      avatarUrl: msg.avatarUrl as string | null | undefined,
      modelProfileId: msg.modelProfileId as string | undefined,
    })
    sendResult(agent)
  },

  'agents.update'(msg, { sendResult }) {
    const agent = updateProjectAgent(msg.agentId as string, {
      name: msg.name as string | undefined,
      type: msg.agentType as string | undefined,
      runtime: msg.runtime as string | undefined,
      systemPrompt: msg.systemPrompt as string | undefined,
      icon: msg.icon as string | undefined,
      avatarUrl: msg.avatarUrl as string | null | undefined,
      modelProfileId: msg.modelProfileId as string | null | undefined,
    })
    sendResult(agent)
  },

  'agents.delete'(msg, { sendResult }) {
    deleteProjectAgent(msg.agentId as string)
    sendResult({ deleted: true })
  },

  'agents.setHidden'(msg, { sendResult }) {
    sendResult(agentStore.setHidden(msg.agentId as string, msg.hidden === true))
  },

  'agents.reorder'(msg, { sendResult }) {
    sendResult(agentStore.reorder(msg.projectId as string, msg.agentIds as string[]))
  },
}
