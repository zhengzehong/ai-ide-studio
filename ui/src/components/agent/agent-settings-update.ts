import type { ProjectAgentInput } from '../../stores/agent.store'

export interface AgentSettingsUpdateValues {
  name: string
  icon: string
  avatarUrl: string | null | undefined
  modelProfileId: string | null
  modelProfileMode: 'global' | 'fixed' | 'system'
  systemPrompt: string
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
    systemPrompt: values.systemPrompt,
  }
}
