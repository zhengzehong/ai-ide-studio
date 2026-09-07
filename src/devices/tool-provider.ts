import { loadConfig } from '../core/config.js'
import { createToolContext, validateToolToken } from '../tools/registry/context-registry.js'
import type { ToolContext } from '../tools/types.js'

export type DeviceToolAction = 'device_list' | 'invoke_device_command'
type DeviceToolExecutor = (action: DeviceToolAction, input: Record<string, unknown>, context: ToolContext) => Promise<unknown>
let localExecutor: DeviceToolExecutor | undefined
const bridgeTokens = new Map<string, string>()

export function registerDeviceToolExecutor(executor: DeviceToolExecutor): () => void {
  localExecutor = executor
  return () => { if (localExecutor === executor) localExecutor = undefined }
}

export async function executeDeviceTool(action: DeviceToolAction, input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  if (!context.sessionId || !context.agentId) throw new Error('设备工具需要会话和 Agent 上下文')
  if (localExecutor) return localExecutor(action, input, context)
  const key = JSON.stringify([context.sessionId, context.agentId, context.projectId])
  let token = bridgeTokens.get(key)
  if (!token || !validateToolToken(token)) {
    // Separate scoped credential: do not rotate the session's existing MCP token.
    token = createToolContext({ ...context, sessionId: context.sessionId, agentId: context.agentId,
      visibleTools: ['device_list', 'invoke_device_command'], ttlMs: 60 * 60_000 }).token
    if (bridgeTokens.size >= 256) bridgeTokens.clear()
    bridgeTokens.set(key, token)
  }
  const config = loadConfig()
  const base = process.env.AI_IDE_DEVICE_GATEWAY_URL || `http://127.0.0.1:${config.port}`
  const response = await fetch(new URL('/device-tools', base), {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(15_000),
  })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error('远程设备工具入口不可用或未授权')
  if (body && typeof body === 'object' && 'error' in body) throw new Error(String(body.error))
  return body
}
