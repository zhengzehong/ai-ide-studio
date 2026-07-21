import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  createApiProcess,
  type ApiProcessHandle,
} from '../../src/edge/api-process-client.js'

let api: ApiProcessHandle | undefined
let dataDir: string | undefined

afterEach(async () => {
  await api?.close()
  api = undefined
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = undefined
})

describe('supervised API process', () => {
  it('starts API and Realtime on loopback dynamic ports', async () => {
    api = await startApi()

    expect(api.targets.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(api.targets.realtimeUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
    expect(new URL(api.targets.apiUrl as string).port).not.toBe('18900')

    const response = await fetch(`${api.targets.apiUrl}/api/v1/realtime-config`)
    await expect(response.json()).resolves.toMatchObject({
      wsUrl: expect.stringMatching(/\/realtime$/),
    })
  })

  it('clears targets on a crash and restores both after restart', async () => {
    api = await startApi()
    const generations: number[] = []
    const snapshots: Array<{ apiUrl?: string; realtimeUrl?: string }> = []
    const unsubscribe = api.onTargetsChange((targets) => {
      generations.push(api?.generation ?? 0)
      snapshots.push({ ...targets })
    })
    const previousGeneration = api.generation
    const previousRealtimeUrl = api.targets.realtimeUrl as string

    await api.terminateForTest()
    expect(snapshots).toContainEqual({})
    await expect(waitForWebSocketClose(previousRealtimeUrl)).resolves.toBeUndefined()
    await api.waitForRestart(previousGeneration, 10_000)

    expect(api.generation).toBeGreaterThan(previousGeneration)
    expect(api.targets.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(api.targets.realtimeUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
    expect(generations.length).toBeGreaterThanOrEqual(3)
    unsubscribe()
  }, 20_000)

  it('acknowledges a test block only after the API event loop resumes', async () => {
    api = await startApi()
    const startedAt = performance.now()

    await api.blockForTest(75)

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(65)
  })
})

async function startApi(): Promise<ApiProcessHandle> {
  dataDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-edge-api-'))
  return createApiProcess({
    config: {
      host: '0.0.0.0',
      port: 18900,
      dataDir,
      runtime: 'web',
      dataWorkerMode: 'local',
      realtimeMode: 'process',
      runtimeMode: 'embedded',
      edgeMode: 'process',
      edgeRealtimePath: '/realtime',
    },
    restartDelayMs: 10,
  })
}

async function waitForWebSocketClose(url: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolveConnected) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.terminate()
        resolveConnected(false)
      }, 250)
      socket.once('open', () => {
        clearTimeout(timer)
        socket.close()
        resolveConnected(true)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        resolveConnected(false)
      })
    })
    if (!connected) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
  throw new Error(`Realtime child still accepts connections at ${url}`)
}
