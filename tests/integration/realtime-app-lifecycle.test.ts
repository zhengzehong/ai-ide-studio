import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startApp, type AppHandle } from '../../src/app.js'

let app: AppHandle | undefined
let tmp: string | undefined

afterEach(async () => {
  await app?.stop()
  app = undefined
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('application Realtime lifecycle', () => {
  it('starts process Realtime before HTTP discovery and preserves legacy RPC behavior', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-realtime-app-'))
    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'local',
      realtimeMode: 'process',
      realtimePort: 0,
    })

    const response = await fetch(`${httpBase(app)}/api/v1/realtime-config`)
    const config = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(app.realtimeMode).toBe('process')
    expect(config).toMatchObject({
      wsUrl: app.realtimeEndpoint,
      protocolVersion: '1',
      legacyRpcEnabled: true,
    })

    const socket = await connect(String(config.wsUrl))
    socket.send(JSON.stringify({ type: 'projects.list', requestId: 'projects' }))
    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'result',
      requestId: 'projects',
      data: [],
    })
    socket.close()
  })

  it('keeps embedded rollback on the API port', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-realtime-embedded-'))
    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'local',
      realtimeMode: 'embedded',
    })

    const response = await fetch(`${httpBase(app)}/api/v1/realtime-config`)
    const config = await response.json() as Record<string, unknown>

    expect(app.realtimeMode).toBe('embedded')
    expect(new URL(String(config.wsUrl)).port).toBe(new URL(httpBase(app)).port)
  })
})

function httpBase(handle: AppHandle): string {
  const address = handle.server.address()
  if (!address || typeof address === 'string') throw new Error('API server is not listening')
  return `http://127.0.0.1:${address.port}`
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolveOpen, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolveOpen(socket))
    socket.once('error', reject)
  })
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 3_000)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      resolveMessage(JSON.parse(raw.toString()) as Record<string, unknown>)
    })
  })
}
