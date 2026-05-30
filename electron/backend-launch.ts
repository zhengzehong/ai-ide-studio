import { existsSync } from 'fs'
import { delimiter, join } from 'path'

export interface BackendCommandInput {
  resourcesDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  exists?: (path: string) => boolean
}

export interface BackendLaunchInput {
  command: string
  entryPath: string
  port: number
  token: string
  dataDir: string
  resourcesDir: string
  baseEnv: NodeJS.ProcessEnv
  appDir?: string
}

export interface BackendLaunchOptions {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export function resolveBackendNodeCommand(input: BackendCommandInput): string {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  const fileExists = input.exists ?? existsSync

  if (env.AI_IDE_NODE_CMD?.trim()) return env.AI_IDE_NODE_CMD.trim()

  const packagedNode = platform === 'win32'
    ? join(input.resourcesDir, 'node', 'node.exe')
    : join(input.resourcesDir, 'node', 'bin', 'node')

  if (fileExists(packagedNode)) return packagedNode
  return platform === 'win32' ? 'node.exe' : 'node'
}

export function createBackendLaunchOptions(input: BackendLaunchInput): BackendLaunchOptions {
  return {
    command: input.command,
    args: [input.entryPath],
    env: {
      ...input.baseEnv,
      HOST: '127.0.0.1',
      PORT: String(input.port),
      DATA_DIR: input.dataDir,
      STATIC_DIR: join(input.resourcesDir, 'app', 'ui', 'dist'),
      AI_IDE_RUNTIME: 'electron',
      AI_IDE_LOCAL_TOKEN: input.token,
      AI_IDE_RESOURCES_DIR: input.resourcesDir,
      NODE_PATH: createBackendNodePath(input),
    },
  }
}

function createBackendNodePath(input: BackendLaunchInput): string {
  const paths = [
    join(input.resourcesDir, 'app', 'node_modules'),
    input.appDir ? join(input.appDir, 'node_modules') : undefined,
    input.baseEnv.NODE_PATH,
  ].filter((value): value is string => Boolean(value))

  return [...new Set(paths)].join(delimiter)
}
