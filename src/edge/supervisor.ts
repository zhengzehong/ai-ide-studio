import type { AppConfig } from '../core/config.js'
import {
  createApiProcess,
  type ApiProcessHandle,
  type ApiTargets,
} from './api-process-client.js'
import { startEdgeGateway, type EdgeGatewayHandle } from './gateway.js'

export interface UnifiedServiceHandle {
  readonly port: number
  readonly endpointUrl: string
  readonly wsEndpointUrl: string
  readonly apiGeneration: number
  readonly apiTargets: ApiTargets
  blockApiForTest(durationMs: number): Promise<void>
  restartRealtimeForTest(): Promise<void>
  terminateApiForTest(): Promise<void>
  waitForApiRestart(previousGeneration: number, timeoutMs?: number): Promise<void>
  close(): Promise<void>
}

export async function startUnifiedService(config: AppConfig): Promise<UnifiedServiceHandle> {
  const api = await createApiProcess({ config })
  let edge: EdgeGatewayHandle
  try {
    edge = await startEdgeGateway({
      host: config.host,
      port: config.port,
      targets: api.targets,
    })
  } catch (error) {
    await api.close()
    throw error
  }
  const unsubscribeTargets = api.onTargetsChange((targets) => edge.updateTargets(targets))
  let closed = false

  return {
    port: edge.port,
    endpointUrl: edge.endpointUrl,
    wsEndpointUrl: toWebSocketEndpoint(edge.endpointUrl),
    get apiGeneration(): number {
      return api.generation
    },
    get apiTargets(): ApiTargets {
      return api.targets
    },
    blockApiForTest: (durationMs) => api.blockForTest(durationMs),
    restartRealtimeForTest: () => api.restartRealtimeForTest(),
    terminateApiForTest: () => api.terminateForTest(),
    waitForApiRestart: (generation, timeoutMs) => api.waitForRestart(generation, timeoutMs),
    async close(): Promise<void> {
      if (closed) return
      closed = true
      await closeService(edge, api, unsubscribeTargets)
    },
  }
}

function toWebSocketEndpoint(httpEndpoint: string): string {
  const url = new URL(httpEndpoint)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/$/, '')
}

async function closeService(
  edge: EdgeGatewayHandle,
  api: ApiProcessHandle,
  unsubscribeTargets: () => void,
): Promise<void> {
  const errors: unknown[] = []
  await edge.close().catch((error) => errors.push(error))
  unsubscribeTargets()
  await api.close().catch((error) => errors.push(error))
  if (errors.length > 0) throw new AggregateError(errors, 'Unified service shutdown completed with errors')
}
