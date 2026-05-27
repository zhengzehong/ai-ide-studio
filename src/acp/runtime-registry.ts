import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

export interface RuntimeCommand {
  cmd: string
  args: string[]
}

interface RuntimeSpec {
  binName: string
  envKey: string
  npxPackage: string
}

const RUNTIMES: Record<string, RuntimeSpec> = {
  claude: { binName: 'claude-agent-acp', envKey: 'AI_IDE_CLAUDE_ACP_CMD', npxPackage: 'claude-agent-acp' },
  codex: { binName: 'codex-acp', envKey: 'AI_IDE_CODEX_ACP_CMD', npxPackage: 'codex-acp' },
}

export function getRuntimeCommand(runtime: string): RuntimeCommand | undefined {
  const spec = RUNTIMES[runtime]
  if (!spec) return undefined

  const override = process.env[spec.envKey]
  if (override?.trim()) return parseCommandLine(override.trim())

  const localBin = resolveLocalBin(spec.binName)
  if (localBin) return { cmd: localBin, args: [] }

  return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: [spec.npxPackage] }
}

export function listRuntimeNames(): string[] {
  return Object.keys(RUNTIMES)
}

function resolveLocalBin(binName: string): string | undefined {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const candidates = [
    resolve(process.cwd(), 'node_modules', '.bin', `${binName}${suffix}`),
    resolve(projectRootFromModule(), 'node_modules', '.bin', `${binName}${suffix}`),
  ]
  return candidates.find(path => existsSync(path))
}

function projectRootFromModule(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function parseCommandLine(value: string): RuntimeCommand {
  const parts = value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(part => part.replace(/^"|"$/g, '')) ?? []
  const [cmd, ...args] = parts
  return { cmd, args }
}
