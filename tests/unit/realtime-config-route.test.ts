import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { mountRealtimeConfigRoute } from '../../src/gateway/http/realtime-config-route.js'

describe('Realtime config route', () => {
  it('keeps the direct Realtime endpoint when no public path is configured', async () => {
    const app = new Hono()
    mountRealtimeConfigRoute(app, () => ({
      mode: 'process',
      host: '127.0.0.1',
      port: 18901,
      legacyRpcEnabled: true,
    }))

    const response = await app.request('http://machine.local:18900/api/v1/realtime-config')

    await expect(response.json()).resolves.toMatchObject({
      wsUrl: 'ws://127.0.0.1:18901',
      mode: 'process',
    })
  })

  it('advertises the same public authority and path without an internal port', async () => {
    const app = new Hono()
    mountRealtimeConfigRoute(app, () => ({
      mode: 'process',
      host: '127.0.0.1',
      port: 54321,
      publicPath: '/realtime',
      legacyRpcEnabled: true,
    }))

    const response = await app.request('http://machine.local:18900/api/v1/realtime-config')

    await expect(response.json()).resolves.toMatchObject({
      wsUrl: 'ws://machine.local:18900/realtime',
      mode: 'process',
    })
  })

  it('uses forwarded TLS authority for remote access', async () => {
    const app = new Hono()
    mountRealtimeConfigRoute(app, () => ({
      mode: 'process',
      host: '127.0.0.1',
      port: 54321,
      publicPath: '/realtime',
      legacyRpcEnabled: true,
    }))

    const response = await app.request('http://internal:54320/api/v1/realtime-config', {
      headers: {
        'x-forwarded-host': 'studio.example.com',
        'x-forwarded-proto': 'https',
      },
    })

    await expect(response.json()).resolves.toMatchObject({
      wsUrl: 'wss://studio.example.com/realtime',
    })
  })
})
