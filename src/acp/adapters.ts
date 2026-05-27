export interface AdapterConfig {
  command: string
  args: string[]
  envKeys: string[]
  description: string
}

export const SUPPORTED_AGENT_RUNTIMES = ['mock', 'claude', 'codex'] as const
export type SupportedAgentRuntime = typeof SUPPORTED_AGENT_RUNTIMES[number]

export function isSupportedAgentRuntime(runtime: string): runtime is SupportedAgentRuntime {
  return (SUPPORTED_AGENT_RUNTIMES as readonly string[]).includes(runtime)
}

export const ADAPTERS: Record<SupportedAgentRuntime, AdapterConfig> = {
  mock: {
    command: 'node',
    args: [],
    envKeys: [],
    description: 'Built-in Mock Agent for local testing',
  },
  claude: {
    command: 'npx',
    args: ['claude-agent-acp'],
    envKeys: [],
    description: 'Claude Code via @agentclientprotocol/claude-agent-acp',
  },
  codex: {
    command: 'npx',
    args: ['codex-acp'],
    envKeys: [],
    description: 'Codex via @agentclientprotocol/codex-acp',
  },
}
