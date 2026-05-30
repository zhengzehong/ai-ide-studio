import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, extname, normalize, resolve } from 'path'
import { fileURLToPath } from 'url'

export interface RuntimeCommand {
  cmd: string
  args: string[]
}

type CommandPathResolver = (command: string) => string[]

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

  const packagedBin = resolvePackagedBin(spec.binName)
  if (packagedBin) return { cmd: packagedBin, args: [] }

  const localBin = resolveLocalBin(spec.binName)
  if (localBin) return { cmd: localBin, args: [] }

  return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: [spec.npxPackage] }
}

export function listRuntimeNames(): string[] {
  return Object.keys(RUNTIMES)
}

export function buildRuntimeEnv(
  runtime: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  commandPathResolver: CommandPathResolver = resolveCommandPaths,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  if (runtime === 'codex' && !env.CODEX_PATH) {
    const codexPath = selectSystemCodexPath(commandPathResolver('codex'))
    if (codexPath) env.CODEX_PATH = codexPath
  }
  return env
}

export function selectSystemCodexPath(paths: string[], platform: NodeJS.Platform = process.platform): string | undefined {
  const candidates = paths.map(path => path.trim()).filter(path => path && !isProjectLocalBin(path))
  if (platform !== 'win32') return candidates[0]

  return findByExtension(candidates, '.cmd')
    ?? findByExtension(candidates, '.bat')
    ?? findByExtension(candidates, '.exe')
}

function resolvePackagedBin(binName: string): string | undefined {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const resourcesDir = process.env.AI_IDE_RESOURCES_DIR
  if (!resourcesDir) return undefined

  const candidates = [
    resolve(resourcesDir, 'runtimes', `${binName}${suffix}`),
    resolve(resourcesDir, 'node_modules', '.bin', `${binName}${suffix}`),
  ]
  return candidates.find(path => existsSync(path))
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

function resolveCommandPaths(command: string): string[] {
  try {
    if (process.platform === 'win32') {
      return execFileSync('where.exe', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)
    }
    return execFileSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)
  } catch {
    return []
  }
}

function isProjectLocalBin(path: string): boolean {
  const normalized = normalize(path).replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/node_modules/.bin/')
}

function findByExtension(paths: string[], extension: string): string | undefined {
  return paths.find(path => extname(path).toLowerCase() === extension)
}
