export interface RuntimeCommand {
  cmd: string
  args: string[]
}

const RUNTIME_COMMANDS: Record<string, RuntimeCommand> = {
  claude: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['claude-agent-acp'] },
  codex: { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['codex-acp'] },
}

export function getRuntimeCommand(runtime: string): RuntimeCommand | undefined {
  return RUNTIME_COMMANDS[runtime]
}

export function listRuntimeNames(): string[] {
  return Object.keys(RUNTIME_COMMANDS)
}
