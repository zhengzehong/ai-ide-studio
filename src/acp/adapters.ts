export interface AdapterConfig {
  command: string
  args: string[]
  envKeys: string[]
  description: string
}

export const ADAPTERS: Record<string, AdapterConfig> = {
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
  mock: {
    command: 'node',
    args: [],
    envKeys: [],
    description: '内置 Mock Agent（测试用）',
  },
}
