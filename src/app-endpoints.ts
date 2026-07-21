import type { Server } from 'http'
import type { RealtimeMode } from './core/config.js'
import type { RealtimeProcessHandle } from './realtime/process-client.js'

export function serverPort(server: Server): number {
  const address = server.address()
  return address && typeof address !== 'string' ? address.port : 0
}

export function embeddedRealtimeEndpoint(host: string, server: Server): string {
  return `ws://${formatPublicHost(host)}:${serverPort(server)}`
}

export function httpServerEndpoint(host: string, server: Server): string {
  return `http://${formatPublicHost(host)}:${serverPort(server)}`
}

export function createRealtimeEndpointSubscription(
  mode: RealtimeMode,
  realtimeProcess: RealtimeProcessHandle | undefined,
  initialEndpoint: string,
): (listener: (endpointUrl: string) => void) => () => void {
  if (mode === 'process') {
    return (listener) => (realtimeProcess as RealtimeProcessHandle).onEndpointChange(listener)
  }
  return (listener) => {
    listener(initialEndpoint)
    return () => undefined
  }
}

export async function restartRealtimeForTest(
  mode: RealtimeMode,
  realtimeProcess: RealtimeProcessHandle | undefined,
): Promise<void> {
  if (mode !== 'process' || !realtimeProcess) throw new Error('Process Realtime is not enabled')
  const previousGeneration = realtimeProcess.generation
  await realtimeProcess.terminateForTest()
  await realtimeProcess.waitForRestart(previousGeneration)
}

function formatPublicHost(host: string): string {
  const publicHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return publicHost.includes(':') && !publicHost.startsWith('[') ? `[${publicHost}]` : publicHost
}
