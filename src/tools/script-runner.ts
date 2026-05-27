import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { ScriptConfig, ToolContext, ToolDefinition, ToolHandlerInput, ToolHandlerResult } from './types.js'

interface ScriptModule {
  default?: unknown
  execute?: unknown
}

type ScriptExecute = (input: ToolHandlerInput, context: ToolContext) => unknown | Promise<unknown>

export async function runScriptTool(tool: ToolDefinition, input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
  const config = tool.config as ScriptConfig
  if (config.runtime !== 'node') {
    return errorResult(`Unsupported script runtime: ${config.runtime}`)
  }
  if (!existsSync(config.scriptPath)) {
    return errorResult(`Script file not found: ${config.scriptPath}`)
  }

  const timeout = config.timeout ?? tool.permissions.maxExecutionTime
  try {
    const mod = await import(`${pathToFileURL(config.scriptPath).href}?t=${Date.now()}`) as ScriptModule
    const execute = pickExecutor(mod)
    if (!execute) return errorResult(`Script does not export a default function or execute function: ${config.scriptPath}`)

    const value = await withTimeout(Promise.resolve(execute(input, context)), timeout)
    return normalizeScriptResult(value)
  } catch (err) {
    return errorResult((err as Error).message)
  }
}

function pickExecutor(mod: ScriptModule): ScriptExecute | null {
  if (typeof mod.default === 'function') return mod.default as ScriptExecute
  if (isRecord(mod.default) && typeof mod.default.execute === 'function') return mod.default.execute as ScriptExecute
  if (typeof mod.execute === 'function') return mod.execute as ScriptExecute
  return null
}

function normalizeScriptResult(value: unknown): ToolHandlerResult {
  if (isToolHandlerResult(value)) return value
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] }
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function isToolHandlerResult(value: unknown): value is ToolHandlerResult {
  if (!isRecord(value) || !Array.isArray(value.content)) return false
  return value.content.every(item => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Script execution timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
