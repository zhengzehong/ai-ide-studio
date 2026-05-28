import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolDefinition, ToolHandlerResult } from './types.js'

export interface ToolPermissionDecision {
  allowed: boolean
  reason?: string
}

export function assertToolAllowed(tool: ToolDefinition): ToolPermissionDecision {
  if (tool.permissions.requiresApproval) {
    return { allowed: false, reason: `Tool ${tool.name} requires approval before execution` }
  }

  if (tool.type === 'script') {
    const config = tool.config as { scriptPath?: string }
    const scriptPath = config.scriptPath
    if (scriptPath && tool.permissions.allowedPaths?.length) {
      const resolvedScript = resolve(scriptPath)
      const allowed = tool.permissions.allowedPaths.some((allowedPath) => isInsidePath(resolvedScript, resolve(allowedPath)))
      if (!allowed) {
        return { allowed: false, reason: `Script path is outside allowed paths: ${resolvedScript}` }
      }
    }
  }

  return { allowed: true }
}

export function toolDeniedResult(decision: ToolPermissionDecision): ToolHandlerResult {
  return {
    content: [{ type: 'text', text: decision.reason || 'Tool execution denied' }],
    isError: true,
  }
}

function isInsidePath(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

