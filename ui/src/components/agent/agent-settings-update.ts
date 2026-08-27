import type { ProjectAgentInput } from '../../stores/agent.store'

export interface AgentSettingsUpdateValues {
  name: string
  icon: string
  avatarUrl: string | null | undefined
  modelProfileId: string | null
  modelProfileMode: 'global' | 'fixed' | 'system'
}

export function buildAgentSettingsUpdate(
  values: AgentSettingsUpdateValues,
): Partial<ProjectAgentInput> {
  return {
    name: values.name.trim(),
    icon: values.icon,
    avatarUrl: values.avatarUrl,
    modelProfileId: values.modelProfileId,
    modelProfileMode: values.modelProfileMode,
  }
}

export function buildAgentSystemPromptUpdate(
  systemPrompt: string,
): Pick<ProjectAgentInput, 'systemPrompt'> {
  return { systemPrompt }
}
