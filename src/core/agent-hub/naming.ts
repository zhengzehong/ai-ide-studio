export interface NamingInput {
  agentId: string
  agentName: string
  agentDescription?: string | null
  machineId: string
  sessionId: string
  projectId?: string | null
}

export interface NamingResult {
  instanceId: string
  name: string
  description: string
  scopeKeys: string[]
}

export function buildHubNaming(input: NamingInput): NamingResult {
  const machineShort = input.machineId.replace(/^mac-/, '').slice(-4)
  const sessionShort = input.sessionId.replace(/^sess-/, '').slice(0, 6)

  const instanceId = `${input.machineId}-${input.agentId}-${input.sessionId}`
  const name = `${input.agentName} · ${machineShort} · ${sessionShort}`
  const baseDescription = input.agentDescription && input.agentDescription.trim().length > 0
    ? input.agentDescription.trim()
    : input.agentName
  const description = `${baseDescription} [${input.machineId} · session ${sessionShort}]`

  const scopeKeys = ['ai-ide-studio', `machine:${input.machineId}`, `agent:${input.agentId}`]
  if (input.projectId) scopeKeys.push(`project:${input.projectId}`)

  return { instanceId, name, description, scopeKeys }
}

export interface AgentInfo {
  hubAgentId: string
  name: string
  description: string
  scopeKeys: string[]
  capabilityTags: string[]
  a2aBaseUrl: string
  status: string
}
