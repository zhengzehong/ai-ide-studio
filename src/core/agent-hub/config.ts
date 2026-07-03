export interface AgentHubConfig {
  enabled: boolean
  hubUrl: string
  providerToken: string
  callerToken: string
  internalToken: string
  defaultScopeKeys: string[]
  machineLabel?: string
}

export function loadAgentHubConfig(): AgentHubConfig {
  const enabled = process.env.AGENT_HUB_ENABLED === 'true'
  return {
    enabled,
    hubUrl: (process.env.AGENT_HUB_URL || '').replace(/\/+$/, ''),
    providerToken: process.env.AGENT_HUB_PROVIDER_TOKEN || '',
    callerToken: process.env.AGENT_HUB_CALLER_TOKEN || '',
    internalToken: process.env.AGENT_HUB_INTERNAL_TOKEN || '',
    defaultScopeKeys: ['ai-ide-studio'],
    machineLabel: process.env.AGENT_HUB_MACHINE_LABEL || undefined,
  }
}
