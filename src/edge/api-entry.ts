import type { AppHandle } from '../app.js'
import { startApp } from '../app.js'
import { createChildLogger } from '../shared/logger.js'
import { shouldHandleInteractiveSignal } from '../shared/process-signal-ownership.js'
import {
  isParentToApiMessage,
  type ApiToParentMessage,
} from './protocol.js'
import { installApiFatalDiagnostics } from './api-fatal-diagnostics.js'

const log = createChildLogger('edge-api-entry')
let app: AppHandle | undefined
const uninstallFatalDiagnostics = installApiFatalDiagnostics({
  listActiveTurns: () => app?.listActivePromptDiagnostics() ?? [],
})
let unsubscribeRealtime: (() => void) | undefined
let currentRealtimeUrl: string | undefined
let stopping = false

async function main(): Promise<void> {
  process.on('message', (message: unknown) => { void handleMessage(message) })
  process.once('disconnect', () => { void shutdown(1, false) })
  process.on('SIGINT', () => {
    if (shouldHandleInteractiveSignal(process.connected)) void shutdown(0, false)
  })
  process.once('SIGTERM', () => { void shutdown(0, false) })
  await send({ type: 'hello' })
}

async function handleMessage(message: unknown): Promise<void> {
  if (!isParentToApiMessage(message) || stopping) return
  try {
    if (message.type === 'start') {
      if (app) throw new Error('API process is already started')
      app = await startApp(message.config)
      await send({
        type: 'ready',
        apiUrl: app.httpEndpoint,
        realtimeUrl: app.realtimeEndpoint,
      })
      currentRealtimeUrl = app.realtimeEndpoint
      unsubscribeRealtime = app.onRealtimeEndpointChange((realtimeUrl) => {
        if (realtimeUrl === currentRealtimeUrl) return
        currentRealtimeUrl = realtimeUrl
        void send({ type: 'realtime.changed', realtimeUrl })
          .catch((error) => log.warn({ err: error }, 'Failed to publish Realtime target change'))
      })
      return
    }
    if (message.type === 'test.realtime.restart') {
      if (!app) throw new Error('API application is not started')
      await app.restartRealtimeForTest()
      await send({ type: 'test.realtime.restart.done', requestId: message.requestId })
      return
    }
    if (message.type === 'test.block') {
      blockEventLoop(message.durationMs)
      await send({ type: 'test.block.done', requestId: message.requestId })
      return
    }
    await shutdown(0, true)
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    log.error({ err: error }, 'API child operation failed')
    await send({ type: 'fatal', message: messageText }).catch(() => undefined)
    await shutdown(1, false)
  }
}

async function shutdown(exitCode: number, reportStopped: boolean): Promise<void> {
  if (stopping) return
  stopping = true
  unsubscribeRealtime?.()
  unsubscribeRealtime = undefined
  currentRealtimeUrl = undefined
  await app?.stop().catch((error) => log.warn({ err: error }, 'API application close failed'))
  app = undefined
  if (reportStopped) await send({ type: 'stopped' }).catch(() => undefined)
  uninstallFatalDiagnostics()
  if (process.connected) process.disconnect()
  process.exit(exitCode)
}

function send(message: ApiToParentMessage): Promise<void> {
  if (!process.send || !process.connected) return Promise.reject(new Error('Edge parent IPC is unavailable'))
  return new Promise((resolve, reject) => {
    process.send?.(message, (error) => error ? reject(error) : resolve())
  })
}

function blockEventLoop(durationMs: number): void {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    // Test-only probe used to prove the Edge and Realtime event loops remain responsive.
  }
}

void main().catch(async (error) => {
  log.fatal({ err: error }, 'API child failed to initialize')
  await send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) })
    .catch(() => undefined)
  process.exit(1)
})
