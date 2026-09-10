import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('native-memory-policy')
export const NATIVE_MEMORY_DIRECTORY_ENV = 'AI_IDE_NATIVE_MEMORY_DIRECTORY'

export function applyNativeMemoryPolicy(
  runtime: string,
  agent: { id: string; project_id: string | null },
  env: NodeJS.ProcessEnv,
): void {
  if (runtime === 'claude') {
    const project = agent.project_id ?? 'global'
    if (![project, agent.id].every(value => /^[a-zA-Z0-9_-]+$/.test(value))) {
      throw new Error('原生记忆目录的项目或 Agent ID 无效')
    }
    const directory = resolve(env.DATA_DIR || process.env.DATA_DIR || './data', 'agent-memory', project, agent.id, 'claude')
    try {
      mkdirSync(directory, { recursive: true })
    } catch (err) {
      log.error({ err, agentId: agent.id, directory }, '原生记忆目录初始化失败')
      throw err
    }
    env[NATIVE_MEMORY_DIRECTORY_ENV] = directory
    log.debug({ agentId: agent.id, directory }, '已解析独立原生记忆目录')
  } else if (runtime === 'codex') {
    const config = parseConfig(env.CODEX_CONFIG)
    const features = record(config.features)
    const memories = record(config.memories)
    config.features = { ...features, memories: false }
    config.memories = { ...memories, use_memories: false, generate_memories: false }
    // App-server overrides also accept dotted keys; override both representations.
    for (const key of ['features.memories', 'memories.use_memories', 'memories.generate_memories']) config[key] = false
    env.CODEX_CONFIG = JSON.stringify(config)
  }
}

export function nativeMemorySettings(env: NodeJS.ProcessEnv): { autoMemoryDirectory: string } | undefined {
  const directory = env[NATIVE_MEMORY_DIRECTORY_ENV]
  return directory ? { autoMemoryDirectory: directory } : undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object')
    return parsed as Record<string, unknown>
  } catch (err) {
    log.error({ errorType: err instanceof Error ? err.name : 'unknown' }, 'CODEX_CONFIG 不是有效的 JSON 对象')
    throw new Error('CODEX_CONFIG 必须是有效的 JSON 对象，无法应用原生记忆策略', { cause: err })
  }
}
